// === server.jsx ===
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { handleSocketConnection } from './function.js';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

// createTables();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

io.on('connection', (socket) => {
    handleSocketConnection(socket, io);
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});