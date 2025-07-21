import { createMessage } from './Message.js';

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

            const saved = await createMessage({
                user_id: fromUserId,
                support_ticket_id: ticketId,
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
    socket.on("disconnect", () => {
        if (socket.userId) {
            users.delete(socket.userId);
            console.log(`❌ Disconnected user: ${socket.userId}`);
        }
    });
}
