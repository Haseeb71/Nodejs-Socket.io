import { createMessage, getConversation } from './Message.js';
import {
    createNotification,
    createBroadcastNotification,
    getUserNotifications,
    getUserNotificationsWithStatus,
    getUnreadNotificationCount,
    markNotificationAsRead,
    markAllNotificationsAsRead
} from './Notification.js';

const users = new Map();

export function handleSocketConnection(socket, io) {
    console.log("🔌 Socket connected:", socket.id);

    //  Register a user
    socket.on("register", async (data) => {
        try {
            const { userId } = typeof data === 'string' ? JSON.parse(data) : data;

            users.set(userId, socket);
            socket.userId = userId;

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
    socket.on("sendNotification", (data) => {
        try {
            let parsed;
            try {
                parsed = typeof data === 'string' ? JSON.parse(data) : data;
            } catch (err) {
                console.error("❌ Invalid JSON format:", err.message);
                socket.emit("error", { message: "Invalid JSON format" });
                return;
            }

            const { toUserId, type, message, data: notificationData } = parsed;
            const fromUserId = socket.userId;

            if (!toUserId || !type || !message) {
                return socket.emit("error", { message: "Missing notification fields (toUserId, type, message required)" });
            }

            // Create notification using the notification function
            const notification = createNotification(toUserId, type, message, notificationData);

            // Send notification to specific user if they're online
            const targetUserSocket = users.get(toUserId);
            if (targetUserSocket) {
                targetUserSocket.emit("notification", notification);
                console.log(`✅ Notification sent to user: ${toUserId}`);
            } else {
                console.log(`⚠️ User ${toUserId} is offline, notification stored for later`);
            }

            // Acknowledge to sender
            socket.emit("notificationSent", {
                success: true,
                notificationId: notification.id,
                delivered: !!targetUserSocket
            });

        } catch (err) {
            console.error("❌ sendNotification error:", err.message);
            socket.emit("error", { message: "Notification send failed" });
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

    socket.on("disconnect", () => {
        if (socket.userId) {
            users.delete(socket.userId);
            console.log(`❌ Disconnected user: ${socket.userId}`);
        }
    });
}
