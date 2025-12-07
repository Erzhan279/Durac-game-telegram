const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('Жаңа ойыншы қосылды! ID:', socket.id);
    socket.on('disconnect', () => {
        console.log('Ойыншы шығып кетті:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер жұмыс істеп тұр: http://localhost:${PORT}`);
});
