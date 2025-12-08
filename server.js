const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public'))); // Егер болашақта керек болса

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- ОЙЫН ДЕРЕКТЕРІ ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let game = {
    deck: [], playerHand: [], botHand: [], table: [], // table = [{attack, defend}]
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

// ЛОГИКА: Жабуға бола ма?
function canBeat(attack, defend) {
    if (attack.suit === defend.suit) return defend.power > attack.power;
    if (defend.suit === game.trumpCard.suit && attack.suit !== game.trumpCard.suit) return true;
    return false;
}

// ЛОГИКА: Подкидной
function canToss(card) {
    if (game.table.length === 0) return true; // Бірінші жүріс - кез келген
    // Үстелдегі барлық карталарды (шабуыл және қорғаныс) тексереміз
    let tableCards = [];
    game.table.forEach(pair => {
        tableCards.push(pair.attack);
        if(pair.defend) tableCards.push(pair.defend);
    });
    return tableCards.some(c => c.value === card.value);
}

function botTurn(socket) {
    if (game.winner) return;
    setTimeout(() => {
        if (game.attacker === 'player') { 
            // БОТ ҚОРҒАНАДЫ
            // Соңғы жабылмаған картаны аламыз
            let currentPair = game.table[game.table.length - 1];
            if (currentPair && !currentPair.defend) {
                let candidates = game.botHand.filter(c => canBeat(currentPair.attack, c));
                candidates.sort((a,b) => a.power - b.power);
                
                if (candidates.length > 0) {
                    let card = candidates[0];
                    game.botHand.splice(game.botHand.indexOf(card), 1);
                    currentPair.defend = card;
                    sendUpdate(socket);
                } else {
                    takeCards('bot', socket);
                }
            }
        } else { 
            // БОТ ШАБУЫЛДАЙДЫ
            if (game.table.length === 0) {
                // Ең кіші карта
                game.botHand.sort((a,b) => a.power - b.power);
                let card = game.botHand[0];
                game.botHand.splice(0, 1);
                game.table.push({ attack: card, defend: null });
                sendUpdate(socket);
            } else {
                // Подкидной
                // Тек егер алдыңғы карта жабылған болса
                let allCovered = game.table.every(p => p.defend !== null);
                if (allCovered && game.table.length < 6) {
                    let tossCandidates = game.botHand.filter(c => canToss(c));
                    if (tossCandidates.length > 0) {
                        let card = tossCandidates[0];
                        game.botHand.splice(game.botHand.indexOf(card), 1);
                        game.table.push({ attack: card, defend: null });
                        sendUpdate(socket);
                    } else {
                        endTurn(socket); // Бита
                    }
                }
            }
        }
    }, 1000);
}

function takeCards(who, socket) {
    let cardsToTake = [];
    game.table.forEach(p => {
        cardsToTake.push(p.attack);
        if(p.defend) cardsToTake.push(p.defend);
    });
    game.table = [];
    
    if(who === 'player') game.playerHand.push(...cardsToTake);
    else game.botHand.push(...cardsToTake);
    
    fillHands();
    // Кім алса, сол келесі жолы да қорғанады (шабуылшы ауыспайды)
    // Егер мен шабуылдасам -> бот алды -> мен тағы шабуылдаймын
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
    while (game.playerHand.length < 6 && game.deck.length > 0) game.playerHand.push(game.deck.shift());
    while (game.botHand.length < 6 && game.deck.length > 0) game.botHand.push(game.deck.shift());
    
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
        if (game.attacker === 'bot' && game.table.length === 0) return; // Менің кезегім емес
        
        let card = game.playerHand[index];
        let isValid = false;

        // 1. Егер мен шабуылдасам
        if (game.attacker === 'player') {
            // Тек егер алдыңғы жұп толық жабылған болса (немесе үстел бос болса)
            let allCovered = game.table.every(p => p.defend !== null);
            if (allCovered && canToss(card) && game.table.length < 6) {
                isValid = true;
                game.table.push({ attack: card, defend: null });
            }
        } 
        // 2. Егер мен қорғансам
        else {
            let currentPair = game.table[game.table.length - 1];
            if (currentPair && !currentPair.defend) {
                if (canBeat(currentPair.attack, card)) {
                    isValid = true;
                    currentPair.defend = card;
                }
            }
        }

        if (isValid) {
            game.playerHand.splice(index, 1);
            sendUpdate(socket);
            botTurn(socket);
        } else {
            // Қате жүріс -> Клиентке хабарламай-ақ қоямыз, карта жай ғана орнына қайтады
        }
    });

    socket.on('actionTake', () => { if(game.attacker === 'bot') takeCards('player', socket); });
    socket.on('actionBita', () => { if(game.attacker === 'player') endTurn(socket); });
    socket.on('restart', () => { startGame(); sendUpdate(socket); });
});

server.listen(process.env.PORT || 3000);
