const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);

// Файлдарды ашу
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/game.html', (req, res) => res.sendFile(path.join(__dirname, 'game.html')));

const io = new Server(server, { cors: { origin: "*" } });

// --- ДЕРЕКТЕР ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let usersDB = {};   // Ойыншылар базасы
let queue = [];     // Онлайн кезек
let games = {};     // Бөлмелер (Rooms)

// Колода жасау
function createDeck() {
    let deck = [];
    for (let s of suits) {
        for (let v of values) deck.push({ suit: s, value: v, power: power[v] });
    }
    return deck.sort(() => Math.random() - 0.5);
}

// ОЙЫН БӨЛМЕСІН ҚҰРУ (Универсалды)
function createGameSession(p1Socket, p2Socket = null) {
    const isBot = (p2Socket === null);
    // Бөлме ID-ін жасаймыз
    const roomId = isBot ? `room_${p1Socket.id}_bot` : `room_${p1Socket.id}_${p2Socket.id}`;

    // Ойыншыларды бөлмеге кіргіземіз
    p1Socket.join(roomId);
    if (!isBot) p2Socket.join(roomId);

    let deck = createDeck();
    let trumpCard = deck.pop(); // Уақытша аламыз
    deck.unshift(trumpCard);    // Ең астына (басына) тығамыз (Сенің талабың бойынша)

    // Ойын объектісін жасаймыз
    games[roomId] = {
        roomId: roomId,
        isBot: isBot,
        deck: deck,
        trumpCard: trumpCard,
        table: [],
        players: {
            [p1Socket.id]: { socket: p1Socket, hand: [] }, // Мен
            'opponent': { socket: p2Socket, hand: [] }     // Қарсылас (немесе Бот)
        },
        // ID сақтау (кімнің кім екенін білу үшін)
        p1_id: p1Socket.id,
        p2_id: isBot ? 'bot' : p2Socket.id,
        
        attacker: p1Socket.id, // Бастаушы (Рандом немесе бірінші кірген)
        winner: null
    };

    fillHands(roomId);
    
    // Ойыншыларға "Ойын басталды" деп хабарлаймыз
    io.to(roomId).emit('gameStarted');
    sendGameUpdate(roomId);
}

// Қолды толтыру
function fillHands(roomId) {
    let game = games[roomId];
    if (!game) return;

    const p1 = game.players[game.p1_id];
    const p2 = game.players['opponent'];

    // Екі жаққа да 6 картадан береміз (соңынан аламыз, козырь басында қалады)
    while (p1.hand.length < 6 && game.deck.length > 0) p1.hand.push(game.deck.pop());
    while (p2.hand.length < 6 && game.deck.length > 0) p2.hand.push(game.deck.pop());

    checkWinner(roomId);
}

// Жеңісті тексеру
function checkWinner(roomId) {
    let game = games[roomId];
    if (!game.winner && game.deck.length === 0) {
        if (game.players[game.p1_id].hand.length === 0) {
            game.winner = 'player'; // Player 1 ұтты
            // Тиын беру
            if (usersDB[game.p1_id]) usersDB[game.p1_id].coins += 10;
        } 
        else if (game.players['opponent'].hand.length === 0) {
            game.winner = 'bot'; // Player 2 (немесе бот) ұтты
            // Егер онлайн болса, екінші адамға тиын береміз
            if (!game.isBot && usersDB[game.p2_id]) usersDB[game.p2_id].coins += 10;
        }
    }
}

// Ақпаратты тарату (Екеуіне екі түрлі көрініс)
function sendGameUpdate(roomId) {
    let game = games[roomId];
    if (!game) return;

    // 1. Player 1-ге жібереміз
    const p1Socket = game.players[game.p1_id].socket;
    const p1State = {
        playerHand: game.players[game.p1_id].hand,
        botCardCount: game.players['opponent'].hand.length,
        table: game.table,
        trumpCard: game.trumpCard,
        deckCount: game.deck.length,
        attacker: (game.attacker === game.p1_id) ? 'player' : 'bot',
        winner: game.winner,
        user: usersDB[game.p1_id]
    };
    p1Socket.emit('updateState', p1State);

    // 2. Player 2-ге жібереміз (Егер ол адам болса)
    if (!game.isBot) {
        const p2Socket = game.players['opponent'].socket;
        const p2State = {
            playerHand: game.players['opponent'].hand, // Өз қолы
            botCardCount: game.players[game.p1_id].hand.length, // P1 қолы
            table: game.table,
            trumpCard: game.trumpCard,
            deckCount: game.deck.length,
            attacker: (game.attacker === game.p2_id) ? 'player' : 'bot', // Ол үшін өзі player
            // Жеңісті аударып жібереміз (Егер p1 ұтса -> p2 жеңілді)
            winner: game.winner === 'player' ? 'bot' : (game.winner ? 'player' : null),
            user: usersDB[game.p2_id]
        };
        p2Socket.emit('updateState', p2State);
    }
}

// --- БОТ ЛОГИКАСЫ ---
function botTurn(roomId) {
    let game = games[roomId];
    if (!game || !game.isBot || game.winner) return;

    setTimeout(() => {
        let botHand = game.players['opponent'].hand;
        
        // A. БОТ ҚОРҒАНАДЫ (Адам шабуылда)
        if (game.attacker === game.p1_id) {
            let lastItem = game.table[game.table.length - 1];
            if (lastItem && lastItem.owner === 'player') {
                // Жабу логикасы
                let candidates = botHand.filter(c => {
                    if (c.suit === lastItem.card.suit) return c.power > lastItem.card.power;
                    if (c.suit === game.trumpCard.suit && lastItem.card.suit !== game.trumpCard.suit) return true;
                    return false;
                });
                candidates.sort((a,b) => a.power - b.power);

                if (candidates.length > 0) {
                    let card = candidates[0];
                    botHand.splice(botHand.indexOf(card), 1);
                    game.table.push({ card: card, owner: 'bot' });
                    sendGameUpdate(roomId);
                } else {
                    // Жаба алмаса алады
                    botTakes(roomId);
                }
            }
        } 
        // B. БОТ ШАБУЫЛДАЙДЫ
        else {
            if (game.table.length === 0) {
                botHand.sort((a,b) => a.power - b.power);
                let card = botHand.splice(0, 1)[0];
                game.table.push({ card: card, owner: 'bot' });
                sendGameUpdate(roomId);
            } else {
                // Подкидной (Егер адам жапса)
                let lastItem = game.table[game.table.length - 1];
                if (lastItem.owner === 'player') {
                    let tossCandidates = botHand.filter(c => game.table.some(t => t.card.value === c.value));
                    if (tossCandidates.length > 0) {
                        tossCandidates.sort((a,b) => a.power - b.power);
                        let card = tossCandidates[0];
                        botHand.splice(botHand.indexOf(card), 1);
                        game.table.push({ card: card, owner: 'bot' });
                        sendGameUpdate(roomId);
                    } else {
                        // Бита
                        bita(roomId);
                    }
                }
            }
        }
    }, 1500); // 1.5 секунд ойланады
}

function botTakes(roomId) {
    let game = games[roomId];
    let cards = game.table.map(t => t.card);
    game.players['opponent'].hand.push(...cards);
    game.table = [];
    fillHands(roomId);
    game.attacker = game.p1_id; // Бот алды -> Адам жүреді
    sendGameUpdate(roomId);
}

function bita(roomId) {
    let game = games[roomId];
    game.table = [];
    fillHands(roomId);
    // Кезек ауысады
    game.attacker = (game.attacker === game.p1_id) ? ((game.isBot) ? 'bot' : game.p2_id) : game.p1_id;
    sendGameUpdate(roomId);
    
    // Егер кезек ботқа келсе
    if (game.isBot && game.attacker !== game.p1_id) botTurn(roomId);
}


// --- CONNECTION ---
io.on('connection', (socket) => {
    
    // 1. Логин
    socket.on('login', (userData) => {
        usersDB[socket.id] = { name: userData ? userData.first_name : 'Guest', coins: 100 };
    });

    // 2. Ботпен бастау
    socket.on('startBotGame', () => {
        createGameSession(socket, null);
    });

    // 3. Онлайн іздеу
    socket.on('findGame', () => {
        if (queue.length > 0) {
            let opponent = queue.pop();
            if (opponent.id === socket.id) { queue.push(opponent); return; }
            createGameSession(opponent, socket);
        } else {
            queue.push(socket);
        }
    });

    // 4. Жүріс
    socket.on('playCard', (index) => {
        let roomId = Array.from(socket.rooms).find(r => r.startsWith('room_'));
        let game = games[roomId];
        if (!game) return;

        let isP1 = (socket.id === game.p1_id);
        let playerHand = isP1 ? game.players[game.p1_id].hand : game.players['opponent'].hand;
        
        if (playerHand[index]) {
            // ЛОГИКА ТЕКСЕРУ (Қысқаша)
            let card = playerHand[index];
            let isValid = true; 
            // ... (Бұл жерге canToss/canBeat тексерісін қоюға болады, әзірге рұқсат береміз) ...

            if (isValid) {
                playerHand.splice(index, 1);
                game.table.push({ card: card, owner: isP1 ? 'player' : 'bot' });
                sendGameUpdate(roomId);
                if (game.isBot) botTurn(roomId);
            }
        }
    });

    // 5. Алу
    socket.on('actionTake', () => {
        let roomId = Array.from(socket.rooms).find(r => r.startsWith('room_'));
        let game = games[roomId];
        if(game) {
            let isP1 = (socket.id === game.p1_id);
            let whoTakes = isP1 ? game.players[game.p1_id] : game.players['opponent'];
            
            whoTakes.hand.push(...game.table.map(t => t.card));
            game.table = [];
            fillHands(roomId);
            
            // Адам алса -> Екінші адам (немесе бот) жүреді
            game.attacker = isP1 ? ((game.isBot) ? 'bot' : game.p2_id) : game.p1_id;
            
            sendGameUpdate(roomId);
            if (game.isBot && game.attacker !== game.p1_id) botTurn(roomId);
        }
    });

    // 6. Бита
    socket.on('actionBita', () => {
        let roomId = Array.from(socket.rooms).find(r => r.startsWith('room_'));
        if (roomId) bita(roomId);
    });

    socket.on('restart', () => {
        // Қайта бастау логикасы (жаңа ойын құру)
        // ...
    });

    socket.on('disconnect', () => {
        let index = queue.indexOf(socket);
        if (index !== -1) queue.splice(index, 1);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Ботты қосу
if(process.env.TELEGRAM_BOT_TOKEN) require('./bot');
