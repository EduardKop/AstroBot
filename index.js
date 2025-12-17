require('dotenv').config();
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Проверка переменных окружения
if (!process.env.BOT_TOKEN || !process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('ОШИБКА: Не заданы переменные окружения (BOT_TOKEN, SUPABASE_URL, SUPABASE_KEY)');
  process.exit(1);
}

// 1. Инициализация Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 2. Инициализация Бота
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(async (ctx) => {
  const startPayload = ctx.payload; // UUID сессии из React
  const telegramId = ctx.from.id; // ID пользователя в Telegram
  const username = ctx.from.username ? `@${ctx.from.username}` : 'Без никнейма';
  
  console.log(`📥 Новое подключение: ${username} (ID: ${telegramId}) | Payload: ${startPayload}`);

  // Если открыли бота без ссылки с сайта
  if (!startPayload) {
    return ctx.reply('👋 Привет! Этот бот — ключ от AstroPanel. Начните вход на сайте, чтобы использовать его.');
  }

  try {
    // 3. Ищем менеджера в базе данных
    // Важно: telegram_id в базе должен совпадать с тем, что пришел от Telegram
    // Supabase ожидает точное совпадение типов (число/строка), но JS обычно справляется.
    const { data: manager, error: findError } = await supabase
      .from('managers')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (findError && findError.code !== 'PGRST116') { // PGRST116 = не найдено, другие ошибки - это проблема
      console.error('Ошибка поиска менеджера:', findError);
      return ctx.reply('⚠️ Ошибка базы данных. Попробуйте позже.');
    }

    // --- СЦЕНАРИЙ: ДОСТУП РАЗРЕШЕН ---
    if (manager) {
      
      // Проверка статуса (опционально, если есть поле status)
      if (manager.status === 'blocked' || manager.status === 'banned') {
         await updateSessionStatus(startPayload, 'failed', null);
         return ctx.reply('⛔️ Ваш доступ заблокирован администратором.');
      }

      // Обновляем сессию -> React увидит это через Realtime
      const updated = await updateSessionStatus(startPayload, 'success', manager.id, telegramId);
      
      if (updated) {
        await ctx.reply(`✅ <b>Вход выполнен!</b>\n\nДобро пожаловать, ${manager.name}.\nВы можете вернуться в браузер.`, { parse_mode: 'HTML' });
      } else {
        await ctx.reply('⚠️ Не удалось обновить сессию. Возможно, она истекла. Обновите страницу в браузере.');
      }

    } 
    // --- СЦЕНАРИЙ: ДОСТУП ЗАПРЕЩЕН ---
    else {
      // Отмечаем сессию как неудачную
      await updateSessionStatus(startPayload, 'failed', null);

      // Шаблон сообщения для админа
      const adminMsg = `
⛔️ <b>Доступ не найден</b>

Вашего аккаунта нет в системе. Отправьте данные ниже администратору:

----------------------------
<b>Заявка на доступ:</b>

👤 <b>ФИО:</b> ${ctx.from.first_name} ${ctx.from.last_name || ''}
📱 <b>Телефон:</b> (ваш номер)
📧 <b>Email:</b> (ваша почта)
🆔 <b>Telegram ID:</b> <code>${telegramId}</code>
👤 <b>Ник:</b> ${username}
🎂 <b>Дата рождения:</b> (ДД.ММ.ГГГГ)
📸 <b>Фото:</b> (прикрепите селфи)
----------------------------
      `;

      await ctx.replyWithHTML(adminMsg);
    }

  } catch (err) {
    console.error('Критическая ошибка:', err);
    ctx.reply('Произошла внутренняя ошибка бота.');
  }
});

// Функция обновления статуса в Supabase
async function updateSessionStatus(sessionId, status, managerId, tgId) {
  const updateData = { status };
  if (managerId) updateData.manager_id = managerId;
  if (tgId) updateData.telegram_id = tgId;

  const { error } = await supabase
    .from('auth_sessions')
    .update(updateData)
    .eq('id', sessionId);

  if (error) {
    console.error(`Ошибка обновления сессии ${sessionId}:`, error);
    return false;
  }
  return true;
}

// Запуск бота
bot.launch()
  .then(() => console.log('🚀 Бот AstroAuth успешно запущен на Railway!'))
  .catch((err) => console.error('Ошибка запуска:', err));

// Graceful Stop (чтобы Railway корректно перезагружал бота)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));