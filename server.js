const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let game = {
    deck: [], playerHand: [], botHand: [], table: [], 
    trumpCard: null, attacker: 'player', winner: null
};

function createDeck() {
    let deck = [];
    for (let s of suits) for (let v of values) deck.push({ suit: s, value: v, power: power[v] });
    return deck.sort(() => Math.random() - 0.5);
}

function startGame() {
    game.deck = createDeck();
    game.trumpCard = game.deck[game.deck.length - 1]; 
    game.table = [];
    game.winner = null;
    game.playerHand = [];
    game.botHand = [];
    fillHands();
    game.attacker = 'player'; 
}

function canBeat(attack, defend) {
    if (attack.suit === defend.suit) return defend.power > attack.power;
    if (defend.suit === game.trumpCard.suit && attack.suit !== game.trumpCard.suit) return true;
    return false;
}

function botTurn(socket) {
    if (game.winner) return;
    setTimeout(() => {
        if (game.attacker === 'player') { 
            if (game.table.length === 0) return;
            // Соңғы картаны алу (ескі стильмен)
            const attackCard = game.table[game.table.length - 1].card;
            
            // Егер соңғы карта боттыкі болса, демек ол жапты -> кезек адамда
            if (game.table[game.table.length - 1].owner === 'bot') return;

            let candidates = game.botHand.filter(c => canBeat(attackCard, c));
            candidates.sort((a,b) => a.power - b.power);
            
            if (candidates.length > 0) {
                const card = candidates[0];
                game.botHand.splice(game.botHand.indexOf(card), 1);
                game.table.push({ card, owner: 'bot' });
                sendUpdate(socket);
            } else {
                takeCards('bot', socket);
            }
        } else { 
            // Бот шабуылдайды
            if (game.table.length === 0 || game.table.length % 2 === 0) { // Жұп болса -> жаңа шабуыл
                 // Ең кіші карта
                game.botHand.sort((a,b) => a.power - b.power);
                let card = game.botHand[0];
                
                // Подкидной ережесі
                if (game.table.length > 0) {
                    let tableVals = game.table.map(t => t.card.value);
                    let toss = game.botHand.find(c => tableVals.includes(c.value));
                    if(toss) card = toss;
                    else {
                        endTurn(socket); // Тастайтын жоқ -> Бита
                        return;
                    }
                }

                game.botHand.splice(game.botHand.indexOf(card), 1);
                game.table.push({ card, owner: 'bot' });
                sendUpdate(socket);
            }
        }
    }, 1000);
}

function takeCards(who, socket) {
    let cards = game.table.map(t => t.card);
    if(who === 'player') game.playerHand.push(...cards);
    else game.botHand.push(...cards);
    
    game.table = [];
    fillHands();
    sendUpdate(socket);
    if(game.attacker === 'bot') botTurn(socket);
}

function endTurn(socket) {
    game.table = [];
    fillHands();
    game.attacker = game.attacker === 'player' ? 'bot' : 'player';
    sendUpdate(socket);
    if(game.attacker === 'bot') botTurn(socket);
}

function fillHands() {
    while (game.playerHand.length < 6 && game.deck.length > 0) game.playerHand.push(game.deck.pop());
    while (game.botHand.length < 6 && game.deck.length > 0) game.botHand.push(game.deck.pop());
    if(game.deck.length === 0 && game.playerHand.length === 0) game.winner = 'player';
    if(game.deck.length === 0 && game.botHand.length === 0) game.winner = 'bot';
}

function sendUpdate(socket) {
    socket.emit('updateState', {
        playerHand: game.playerHand, 
        botCardCount: game.botHand.length,
        table: game.table, 
        trumpCard: game.trumpCard,
        deckCount: game.deck.length,
        attacker: game.attacker, 
        winner: game.winner
    });
}

io.on('connection', (socket) => {
    startGame();
    sendUpdate(socket);

    socket.on('playCard', (index) => {
        if (game.attacker === 'bot' && game.table.length % 2 === 0) return;
        
        let card = game.playerHand[index];
        // Қарапайым тексеріс
        if (game.attacker === 'bot') {
             // Қорғаныс
             let attackCard = game.table[game.table.length - 1].card;
             if (!canBeat(attackCard, card)) return;
        } else {
            // Шабуыл (Подкидной)
            if (game.table.length > 0) {
                let tableVals = game.table.map(t => t.card.value);
                if (!tableVals.includes(card.value)) return;
            }
        }

        game.playerHand.splice(index, 1);
        game.table.push({ card, owner: 'player' });
        sendUpdate(socket);
        botTurn(socket);
    });

    socket.on('actionTake', () => { if(game.attacker === 'bot') takeCards('player', socket); });
    socket.on('actionBita', () => { if(game.attacker === 'player') endTurn(socket); });
    socket.on('restart', () => { startGame(); sendUpdate(socket); });
});

server.listen(process.env.PORT || 3000);
