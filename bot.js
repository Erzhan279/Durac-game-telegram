const TelegramBot = require('node-telegram-bot-api');

// 1. Токенді Render-дің жасырын қоймасынан аламыз
const token = process.env.TELEGRAM_BOT_TOKEN; 

// 2. Сайттың сілтемесі (Өзіңнің Render-дегі ссылкаңды қой)
const gameUrl = 'https://durac-game-telegram.onrender.com'; 

// Ботты іске қосу
const bot = new TelegramBot(token, {polling: true});

console.log("Бот сәтті іске қосылды...");

// /start басқандағы жауап
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;

    // Өзін таныстыру мәтіні
    const welcomeMessage = `Сәлем, ${firstName}! 👋\n\n` +
                           `Мен — **Durak Pro** ботымын.\n` +
                           `Мұнда сен достарыңмен немесе мықты боттармен Дурак ойнай аласың.\n\n` +
                           `🏆 Рейтинг жина\n💰 Тиын тап\n🧠 Мықты екеніңді дәлелде!\n\n` +
                           `Ойынды бастау үшін төмендегі батырманы бас 👇`;

    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { 
                        text: "🃏 ОЙНАУ (Play)", 
                        web_app: { url: gameUrl } // Сайтты ашатын батырма
                    }
                ],
                [
                    {
                        text: "📢 Арнаға жазылу",
                        url: "https://t.me/senin_kanalyn" // Қаласаң канал сілтемесін қой
                    }
                ]
            ]
        }
    });
});
