// src/config/db.js
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.HOST_NAME,
  user: process.env.USER,
  password: process.env.PASS,
  database: process.env.DATABASE_NAME,
  port: 3306,
});

// Optional: Test connection when app starts
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database');
    connection.release();
  } catch (err) {
    console.log( process.env.HOST_NAME)
    console.error('❌ Failed to connect to MySQL:', err.message);
  }
})();
