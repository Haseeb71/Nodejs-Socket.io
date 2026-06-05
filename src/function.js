import { createMessage, getConversation } from './Message.js';
import { pool } from './config/db.js';
import {
    createNotification,
    createBroadcastNotification,
    getUserNotifications,
    getUserNotificationsWithStatus,
    getUnreadNotificationCount,
    markNotificationAsRead,
    markAllNotificationsAsRead
} from './Notification.js';

// Translate a client-sent author_id into the real users.id.
// authors.id and users.id overlap (authors.id=10 is a different row than
// users.id=10), so the toUserId the frontend sends can't be trusted — derive
// it from the data, mirroring Laravel's NotificationService::resolveRecipientUserId.
const resolveRecipientUserId = async ({ targetType, targetId, toUserId }) => {
    try {
        // Like/comment on an article: recipient is the article's writer.
        if (targetType === 'article' && targetId) {
            const [rows] = await pool.query(
                `SELECT au.user_id FROM articles a
                   JOIN authors au ON au.id = a.author_id
                  WHERE a.id = ?`, [targetId]);
            if (rows[0]?.user_id) return String(rows[0].user_id);
        }
        // Comment on an article: target_id is the comment id, so walk
        // comment -> article -> author -> user. Only top-level comments
        // (parent_id IS NULL) notify the writer; replies are left untouched.
        if (targetType === 'comment' && targetId) {
            const [rows] = await pool.query(
                `SELECT au.user_id FROM comments c
                   JOIN articles a ON a.id = c.article_id
                   JOIN authors au ON au.id = a.author_id
                  WHERE c.id = ? AND c.parent_id IS NULL`, [targetId]);
            if (rows[0]?.user_id) return String(rows[0].user_id);
        }
        // Following an author etc.: map authors.id -> user_id.
        if (targetType === 'author' && toUserId) {
            const [rows] = await pool.query(
                `SELECT user_id FROM authors WHERE id = ?`, [toUserId]);
            if (rows[0]?.user_id) return String(rows[0].user_id);
        }
    } catch (err) {
        console.error('resolveRecipientUserId failed:', err.message);
    }
    return String(toUserId); // fall back — never break delivery
};

export function handleSocketConnection(socket, io) {
    console.log("🔌 Socket connected:", socket.id);

    //  Register a user
    socket.on("register", async (data) => {
        try {
            const { userId } = typeof data === 'string' ? JSON.parse(data) : data;

            // Normalize to String so room names are consistent even if a client
            // registers a number.
            socket.userId = String(userId);

            // Use a per-user room instead of a single-socket map. The same user
            // can connect from multiple tabs/devices without overwriting each
            // other, and concurrent users are fully isolated by room name.
            socket.join(`user_${socket.userId}`);

            console.log(`✅ User registered:(${userId})`);
            socket.emit("user join", userId);
        } catch (err) {
            console.error("❌ Register error:", err.message);
            socket.emit("error", { message: "Invalid register payload" });
        }
    });

    // Join ticket room
    socket.on("joinTicketRoom", (data) => {
        const { ticketId } = typeof data === 'string' ? JSON.parse(data) : data;
        if (!ticketId) return;

        socket.join(`ticket_${ticketId}`);
        console.log(`📥 ${socket.username} (ID: ${socket.userId}) joined room ticket_${ticketId}`);
    });

    //  Send message
    socket.on("privateMessage", async (data) => {
        try {
            let parsed;
            try {
                parsed = typeof data === 'string' ? JSON.parse(data) : data;
            } catch (err) {
                console.error("❌ Invalid JSON format:", err.message);
                socket.emit("error", { message: "Invalid JSON format" });
                return;
            }

            const { toUserId, ticketId, message, type = 'text' } = parsed;
            const fromUserId = socket.userId;

            if (!fromUserId || !toUserId || !ticketId || !message) {
                return socket.emit("error", { message: "Missing message fields" });
            }
            console.log("Ticket ID", ticketId)
            console.log("From User ID", fromUserId)
            console.log("To User ID", toUserId)
            console.log("Message", message)
            console.log("Type", type)
            
            // Extract numeric part from ticket ID (remove # if present)
            const numericTicketId = ticketId.toString().replace('#', '');
            console.log("Numeric Ticket ID for database:", numericTicketId);
            
            const saved = await createMessage({
                user_id: fromUserId,
                support_ticket_id: numericTicketId,
                message,
                type,
            });
            console.log("✅ Message saved:", saved);

            const payload = {
                id: saved.id,
                fromUserId,
                toUserId,
                ticketId,
                message,
                type,
            };

            io.to(`ticket_${ticketId}`).emit("privateMessage", payload);
        } catch (err) {
            console.error("❌ privateMessage error:", err.message);
            socket.emit("error", { message: "Message send failed" });
        }
    });
    // Send notification
    socket.on("sendNotification", async (data, ack) => {
        console.log("📥 [sendNotification] received", data);
        try {
            let parsed;
            try {
                parsed = typeof data === 'string' ? JSON.parse(data) : data;
            } catch (err) {
                console.error("❌ Invalid JSON format:", err.message);
                if (ack) ack({ error: "Invalid JSON format" });
                return;
            }

            // target_id / target_type were being dropped — keep them to resolve the recipient.
            const { toUserId, type, target_id, target_type, message, data: notificationData } = parsed;
            const fromUserId = socket.userId;

            if (!toUserId || !type || !message) {
                if (ack) ack({ error: "Missing notification fields (toUserId, type, message required)" });
                return;
            }

            // Translate author_id -> real user_id so realtime delivery matches
            // the DB-stored copy (the frontend sends the article's author_id).
            const recipientId = await resolveRecipientUserId({
                targetType: target_type,
                targetId: target_id,
                toUserId,
            });
            if (recipientId !== String(toUserId)) {
                console.log(`🔁 Recipient resolved ${toUserId} -> ${recipientId}`);
            }

            // Create notification using the notification function
            const notification = createNotification(recipientId, type, message, notificationData);

            // Deliver to every socket this user has open, via their room.
            // Routing by room (not a single stored socket) keeps concurrent
            // users isolated and supports multi-tab/multi-device delivery.
            const room = `user_${recipientId}`;
            const isOnline = (io.sockets.adapter.rooms.get(room)?.size ?? 0) > 0;
            if (isOnline) {
                io.to(room).emit("notification", notification);
                console.log(`✅ Notification sent to user: ${recipientId}`);
            } else {
                console.log(`⚠️ User ${recipientId} is offline, notification stored for later`);
            }

            // ✅ Invoke the acknowledgement callback the frontend is waiting on.
            // Must run on every path or the client times out after 10s.
            console.log("📤 [sendNotification] before ack");
            if (ack) {
                ack({
                    success: true,
                    notificationId: notification.id,
                    delivered: isOnline
                });
            }
            console.log("✅ [sendNotification] after ack");

        } catch (err) {
            console.error("❌ sendNotification error:", err.message);
            if (ack) ack({ error: "Notification send failed" });
        }
    });

    // Mark notification as read
    socket.on("markNotificationRead", (data) => {
        try {
            const { notificationId } = typeof data === 'string' ? JSON.parse(data) : data;

            if (!notificationId) {
                return socket.emit("error", { message: "Missing notification ID" });
            }

            const success = markNotificationAsRead(socket.userId, notificationId);

            if (success) {
                socket.emit("notificationRead", {
                    success: true,
                    notificationId,
                    userId: socket.userId
                });
            } else {
                socket.emit("error", { message: "Notification not found" });
            }

        } catch (err) {
            console.error("❌ markNotificationRead error:", err.message);
            socket.emit("error", { message: "Failed to mark notification as read" });
        }
    });

    // Send broadcast notification (without user ID)
    socket.on("sendBroadcastNotification", (data) => {
        try {
            const { type, message, data: notificationData } = typeof data === 'string' ? JSON.parse(data) : data;

            if (!type || !message) {
                return socket.emit("error", { message: "Missing notification fields (type, message required)" });
            }

            const notification = createBroadcastNotification(type, message, notificationData);
            io.emit("broadcastNotification", notification);
            socket.emit("broadcastNotificationSent", { success: true, notificationId: notification.id });

        } catch (err) {
            console.error("❌ sendBroadcastNotification error:", err.message);
            socket.emit("error", { message: "Broadcast notification send failed" });
        }
    });

    // Read messages for a ticket
    socket.on("readMessages", async (data) => {
        try {
            const { ticketId } = typeof data === 'string' ? JSON.parse(data) : data;

            if (!ticketId) {
                return socket.emit("error", { message: "Missing ticketId" });
            }

            const messages = await getConversation(ticketId);
            socket.emit("messagesRead", { success: true, ticketId, messages, userId: socket.userId });

        } catch (err) {
            console.error("❌ readMessages error:", err.message);
            socket.emit("error", { message: "Failed to read messages" });
        }
    });

    // Get all notifications with read/unread breakdown
    socket.on("getAllNotifications", (data) => {
        try {
            const notificationStatus = getUserNotificationsWithStatus(socket.userId);
            socket.emit("allNotifications", { success: true, ...notificationStatus, userId: socket.userId });

        } catch (err) {
            console.error("❌ getAllNotifications error:", err.message);
            socket.emit("error", { message: "Failed to get notifications" });
        }
    });

    // Get unread notification count only
    socket.on("getUnreadCount", (data) => {
        try {
            const unreadCount = getUnreadNotificationCount(socket.userId);

            socket.emit("unreadCount", {
                success: true,
                unreadCount,
                userId: socket.userId
            });

        } catch (err) {
            console.error("❌ getUnreadCount error:", err.message);
            socket.emit("error", { message: "Failed to get unread count" });
        }
    });

    // Mark all notifications as read
    socket.on("markAllNotificationsRead", (data) => {
        try {
            const markedCount = markAllNotificationsAsRead(socket.userId);

            socket.emit("allNotificationsRead", {
                success: true,
                markedCount,
                userId: socket.userId
            });

        } catch (err) {
            console.error("❌ markAllNotificationsRead error:", err.message);
            socket.emit("error", { message: "Failed to mark all notifications as read" });
        }
    });

    socket.on("disconnect", (reason) => {
        console.log("🔌 Socket disconnected:", socket.id, "reason:", reason);
        // Socket.IO removes this socket from its rooms automatically. Other
        // tabs/devices for the same user stay in user_<id>, so the user only
        // counts as offline once their last socket disconnects.
        if (socket.userId) {
            console.log(`❌ Socket for user ${socket.userId} disconnected`);
        }
    });
}
