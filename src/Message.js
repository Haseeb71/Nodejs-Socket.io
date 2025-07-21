import { pool } from './config/db.js';

// Save a message
export const createMessage = async ({
  user_id,
  support_ticket_id,
  message,
  type = 'text',
}) => {
  const [result] = await pool.query(
    `INSERT INTO support_messages (user_id, support_ticket_id, message, type, created_at, updated_at)
     VALUES (?, ?, ?, ?,?,?)`,
    [user_id, support_ticket_id, message, type, new Date(), new Date()]
  );

  return {
    id: result.insertId,
    user_id,
    support_ticket_id,
    message,
    type,
    created_at: new Date(),
    updated_at: new Date()
  };
};






// Get conversation between two users (admin + user)
export const getConversation = async(ticketId) => {
    const result = await pool.query(
        `SELECT * FROM messages
     WHERE ticket_id = $1
     ORDER BY created_at ASC`, [ticketId]
    );
    return result.rows;
};

export const getLastMessagesByTicket = async(userId) => {
    const result = await pool.query(
        `SELECT DISTINCT ON (ticket_id) *
     FROM messages
     WHERE from_user_id = $1 OR to_user_id = $1
     ORDER BY ticket_id, created_at DESC`, [userId]
    );
    return result.rows;
};

// Get distinct users who messaged admin
export const getAllSendersToAdmin = async(adminId) => {
    const result = await pool.query(
        `SELECT DISTINCT from_user_id
     FROM messages
     WHERE to_user_id = $1`, [adminId]
    );
    return result.rows.map((row) => row.from_user_id);
};

// Get last message from each user to admin
export const getLastMessagesToAdmin = async(adminId) => {
    const result = await pool.query(
        `SELECT DISTINCT ON (from_user_id) *
     FROM messages
     WHERE to_user_id = $1
     ORDER BY from_user_id, created_at DESC`, [adminId]
    );
    return result.rows;
};