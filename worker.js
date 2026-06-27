export default {
    async fetch(request, env, ctx) {
        if (request.method !== 'POST') return new Response('OK');
        try {
            const update = await request.json();
            await handleUpdate(update, env, ctx);
        } catch (e) {}
        return new Response('OK');
    }
};

async function bot(method, data, env) {
    const url = `https://api.telegram.org/bot${env.API_KEY}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return await response.json();
}

async function getUser(id, env) {
    const data = await env.DB.get(`user:${id}`, 'json');
    return data || { step: 'NONE', temp_data: '', last_prompt_time: 0 };
}

async function setUser(id, step, temp_data, env) {
    let user = await getUser(id, env);
    if (step !== null) user.step = step;
    if (temp_data !== null) user.temp_data = temp_data;
    user.last_prompt_time = Math.floor(Date.now() / 1000);
    await env.DB.put(`user:${id}`, JSON.stringify(user));
}

async function getAllUsersID(env) {
    const list = await env.DB.list({ prefix: 'user:' });
    return list.keys.map(k => k.name.split(':')[1]);
}

async function getSetting(key, env) {
    return await env.DB.get(`setting:${key}`);
}

async function setSetting(key, value, env) {
    await env.DB.put(`setting:${key}`, value);
}

async function deleteSetting(key, env) {
    await env.DB.delete(`setting:${key}`);
}

async function getAdminRole(id, env) {
    if (id.toString() === env.MAIN_ADMIN.toString()) return 'owner';
    const role = await env.DB.get(`admin:${id}`);
    return role ? role : false;
}

async function addAdmin(id, role, env) {
    await env.DB.put(`admin:${id}`, role);
}

async function removeAdmin(id, env) {
    await env.DB.delete(`admin:${id}`);
}

async function getSubAdminsWithRoles(env) {
    const list = await env.DB.list({ prefix: 'admin:' });
    let admins = [];
    for (const key of list.keys) {
        const id = key.name.split(':')[1];
        const role = await env.DB.get(key.name);
        admins.push({ user_id: id, role });
    }
    return admins;
}

async function getChannels(env) {
    const chans = await env.DB.get('channels', 'json');
    return chans || [];
}

async function addChannel(id, env) {
    let chans = await getChannels(env);
    if (!chans.includes(id)) {
        chans.push(id);
        await env.DB.put('channels', JSON.stringify(chans));
    }
}

async function removeChannel(id, env) {
    let chans = await getChannels(env);
    chans = chans.filter(c => c.toString() !== id.toString());
    await env.DB.put('channels', JSON.stringify(chans));
}

async function saveFileEntry(uid, type, data, env) {
    await env.DB.put(`file:${uid}`, JSON.stringify({ type, data }));
}

async function getFileEntry(uid, env) {
    return await env.DB.get(`file:${uid}`, 'json');
}

async function deleteFileEntry(uid, env) {
    await env.DB.delete(`file:${uid}`);
}

function generateRandomString(length = 8) {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let result = "";
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

function getFileInfo(msg) {
    if (msg.photo) {
        const last = msg.photo[msg.photo.length - 1];
        return { file_id: last.file_id, file_unique_id: last.file_unique_id, type: 'photo' };
    } else if (msg.video) return { file_id: msg.video.file_id, file_unique_id: msg.video.file_unique_id, type: 'video' };
    else if (msg.audio) return { file_id: msg.audio.file_id, file_unique_id: msg.audio.file_unique_id, type: 'audio' };
    else if (msg.document) return { file_id: msg.document.file_id, file_unique_id: msg.document.file_unique_id, type: 'document' };
    else if (msg.voice) return { file_id: msg.voice.file_id, file_unique_id: msg.voice.file_unique_id, type: 'voice' };
    return null;
}

async function showAdminPanel(chat_id, role, message_id, env) {
    let buttons = [
        [{ text: 'آپلود تکی', callback_data: 'upl_single' }, { text: 'آپلود چندتایی', callback_data: 'upl_multi' }],
        [{ text: 'مدیریت و جستجوی فایل', callback_data: 'man_search' }]
    ];

    if (role === 'full' || role === 'owner') {
        buttons.push([{ text: 'ارسال پیام همگانی', callback_data: 'broadcast' }, { text: 'مشاهده آمار', callback_data: 'stats' }]);
        buttons.push([{ text: 'تنظیمات سیستم', callback_data: 'settings' }]);
    }

    const text = `سلام. وقتتون بخیر.\nسطح دسترسی شما در حال حاضر: **${role.toUpperCase()}**\n\nجهت ادامه کار، یکی از گزینه‌های زیر را انتخاب نمایید:`;
    const markup = { inline_keyboard: buttons };

    if (message_id) {
        await bot('editMessageText', { chat_id, message_id, text, parse_mode: 'Markdown', reply_markup: markup }, env);
    } else {
        await bot('sendMessage', { chat_id, text, parse_mode: 'Markdown', reply_markup: markup }, env);
    }
}

async function askForMultiCaption(chat_id, target_msg_id, fileIndex, env) {
    const markup = {
        inline_keyboard: [
            [{ text: 'ادامه بدون کپشن (این فایل)', callback_data: 'multi_skip_one' }],
            [{ text: 'برای هیچکدام کپشن نمیخوام', callback_data: 'multi_skip_all' }],
            [{ text: 'اتمام بارگذاری و دریافت لینک', callback_data: 'multi_finish' }]
        ]
    };
    await bot('sendMessage', {
        chat_id,
        text: `لطفاً متن توضیحات (کپشن) را برای این فایل بفرستید:\n\n(وضعیت: در حال بررسی فایل شماره ${fileIndex + 1})`,
        reply_to_message_id: target_msg_id,
        reply_markup: markup
    }, env);
}

async function processSendFile(chat_id, uid, env, ctx) {
    const entry = await getFileEntry(uid, env);
    if (!entry) {
        await bot('sendMessage', { chat_id, text: "متأسفانه فایل مورد نظر پیدا نشد." }, env);
        return;
    }

    let sentMsgIds = [];

    if (entry.type === 'single') {
        const d = entry.data;
        const fileType = d.file_type || d.type;
        const method = fileType === 'document' ? 'sendDocument' : `send${fileType.charAt(0).toUpperCase() + fileType.slice(1)}`;
        let payload = { chat_id, caption: d.caption };
        payload[fileType] = d.file_id;
        
        const res = await bot(method, payload, env);
        if (res.result && res.result.message_id) sentMsgIds.push(res.result.message_id);
    } else {
        const inf = await bot('sendMessage', { chat_id, text: "لطفاً چند لحظه صبر کنید، فایل‌ها در حال ارسال هستند..." }, env);
        if (inf.result && inf.result.message_id) sentMsgIds.push(inf.result.message_id);
        
        if (entry.data.files && Array.isArray(entry.data.files)) {
            for (const f of entry.data.files) {
                const method = f.type === 'document' ? 'sendDocument' : `send${f.type.charAt(0).toUpperCase() + f.type.slice(1)}`;
                let payload = { chat_id, caption: f.caption };
                payload[f.type] = f.file_id;
                const res = await bot(method, payload, env);
                if (res.result && res.result.message_id) sentMsgIds.push(res.result.message_id);
                await new Promise(r => setTimeout(r, 100));
            }
        }
    }

    const warnRes = await bot('sendMessage', {
        chat_id,
        text: "توجه داشته باشید که فایل‌های فرستاده شده تا ۳۰ ثانیه دیگر به دلایل امنیتی و فنی به صورت خودکار حذف می‌شوند. برای حفظ آن‌ها، لطفاً سریعاً پیام‌ها را در بخش پیام‌های ذخیره‌شده (Saved Messages) تلگرام خود ذخیره یا فوروارد کنید.\n\n(اگر فایل‌ها پاک شدند، می‌توانید مجدداً از طریق لینک اقدام کنید.)",
        parse_mode: 'Markdown'
    }, env);
    if (warnRes.result && warnRes.result.message_id) sentMsgIds.push(warnRes.result.message_id);

    if (sentMsgIds.length > 0) {
        ctx.waitUntil((async () => {
            await new Promise(resolve => setTimeout(resolve, 29000));
            try {
                let delRes = await bot('deleteMessages', { chat_id, message_ids: sentMsgIds }, env);
                if (!delRes || !delRes.ok) {
                    for (const mid of sentMsgIds) {
                        await bot('deleteMessage', { chat_id, message_id: mid }, env);
                        await new Promise(r => setTimeout(r, 50));
                    }
                }
            } catch (err) {
                for (const mid of sentMsgIds) {
                    await bot('deleteMessage', { chat_id, message_id: mid }, env);
                    await new Promise(r => setTimeout(r, 50));
                }
            }
        })());
    }
}

async function handleUpdate(update, env, ctx) {
    if (update.my_chat_member) {
        const mcm = update.my_chat_member;
        const newStatus = mcm.new_chat_member.status;
        const chatId = mcm.chat.id;
        const chatTitle = mcm.chat.title || "Channel";

        if (newStatus === 'left' || newStatus === 'kicked') {
            const chans = await getChannels(env);
            if (chans.includes(chatId.toString()) || chans.includes(chatId)) {
                await removeChannel(chatId, env);
                await bot('sendMessage', {
                    chat_id: env.MAIN_ADMIN,
                    text: `گزارش سیستم:\nربات از کانال **${chatTitle}** با آیدی عددی \`${chatId}\` خارج یا اخراج شد.\nبه همین دلیل، این کانال از لیست عضویت اجباری برداشته شد.`,
                    parse_mode: 'Markdown'
                }, env);
            }
        }
        return;
    }

    if (update.message) {
        const message = update.message;
        const chat_id = message.chat.id;
        const text = message.text || null;
        const from_id = message.from.id;

        await setUser(from_id, null, null, env);
        const userData = await getUser(from_id, env);
        const state = userData.step;
        const adminRole = await getAdminRole(from_id, env);
        const isAdmin = adminRole !== false;

        if (isAdmin) {
            if (text === '/start' || text === '/admin' || text === '/panel') {
                await setUser(from_id, 'NONE', '', env);
                return await showAdminPanel(chat_id, adminRole, null, env);
            }

            if (state === 'WAITING_NEW_ADMIN' && adminRole === 'owner') {
                if (!isNaN(text)) {
                    await setUser(from_id, 'NONE', text, env);
                    return await bot('sendMessage', {
                        chat_id,
                        text: `شناسه عددی **${text}** با موفقیت ثبت شد.\n\nلطفاً سطح دسترسی مورد نظر را برای این ادمین جدید انتخاب کنید:`,
                        reply_markup: { inline_keyboard: [
                            [{ text: 'ادمین آپلودر', callback_data: `setrole_uploader_${text}` }],
                            [{ text: 'ادمین با دسترسی کامل', callback_data: `setrole_full_${text}` }],
                            [{ text: 'بازگشت', callback_data: 'settings' }]
                        ]}
                    }, env);
                }
                return await bot('sendMessage', { chat_id, text: "لطفاً فقط شناسه عددی ارسال کنید." }, env);
            }

            if (state === 'WAITING_CHANNEL' && (adminRole === 'owner' || adminRole === 'full')) {
                if (message.forward_from_chat && message.forward_from_chat.type === 'channel') {
                    await addChannel(message.forward_from_chat.id, env);
                    await setUser(from_id, 'NONE', null, env);
                    await bot('sendMessage', { chat_id, text: "کانال عمومی با موفقیت به سیستم اضافه شد." }, env);
                    return await showAdminPanel(chat_id, adminRole, null, env);
                }
                return await bot('sendMessage', { chat_id, text: "لطفاً یک پیام از کانال عمومی مورد نظرتان را به این چت فوروارد کنید." }, env);
            }

            if (state === 'WAITING_PRIVATE_LINK' && (adminRole === 'owner' || adminRole === 'full')) {
                await setUser(from_id, 'WAITING_PRIVATE_ID', text, env);
                return await bot('sendMessage', { chat_id, text: "لینک دعوت دریافت شد. در مرحله بعد، لطفاً شناسه عددی (Channel ID) این کانال خصوصی را فرستاده و تایید کنید:" }, env);
            }

            if (state === 'WAITING_PRIVATE_ID' && (adminRole === 'owner' || adminRole === 'full')) {
                if (!isNaN(text)) {
                    await addChannel(text, env);
                    await setUser(from_id, 'NONE', null, env);
                    await bot('sendMessage', { chat_id, text: `کانال خصوصی با شناسه عددی ${text} با موفقیت به سیستم اضافه شد.` }, env);
                    return await showAdminPanel(chat_id, adminRole, null, env);
                }
                return await bot('sendMessage', { chat_id, text: "خطا: لطفاً فقط شناسه عددی صحیح و معتبر را ارسال کنید." }, env);
            }

            if (state === 'WAITING_REACTION_LINK' && (adminRole === 'owner' || adminRole === 'full')) {
                await setSetting('reaction_channel_link', text, env);
                await setUser(from_id, 'NONE', null, env);
                await bot('sendMessage', { chat_id, text: `لینک کانال واکنش (ریکشن) با موفقیت تنظیم شد:\n${text}` }, env);
                return await showAdminPanel(chat_id, adminRole, null, env);
            }

            if (state === 'WAITING_BROADCAST' && (adminRole === 'owner' || adminRole === 'full')) {
                const allUsers = await getAllUsersID(env);
                await bot('sendMessage', { chat_id, text: `عملیات ارسال پیام به ${allUsers.length} کاربر آغاز شد. لطفاً منتظر بمانید...` }, env);
                
                ctx.waitUntil((async () => {
                    for (const uid of allUsers) {
                        let payload = { chat_id: uid, caption: message.caption || '' };
                        let method = 'sendMessage';
                        if (text) { payload.text = text; delete payload.caption; }
                        else if (message.photo) { method = 'sendPhoto'; payload.photo = message.photo[message.photo.length-1].file_id; }
                        else if (message.video) { method = 'sendVideo'; payload.video = message.video.file_id; }
                        else if (message.document) { method = 'sendDocument'; payload.document = message.document.file_id; }
                        
                        await bot(method, payload, env);
                        await new Promise(r => setTimeout(r, 50));
                    }
                    await bot('sendMessage', { chat_id: env.MAIN_ADMIN, text: "ارسال همگانی پیام با موفقیت به پایان رسید." }, env);
                })());
                await setUser(from_id, 'NONE', null, env);
                return await showAdminPanel(chat_id, adminRole, null, env);
            }

            if (state === 'UPLOAD_SINGLE') {
                const file = getFileInfo(message);
                if (file) {
                    await setUser(from_id, 'UPLOAD_SINGLE_CAPTION', JSON.stringify(file), env);
                    return await bot('sendMessage', {
                        chat_id,
                        text: "فایل شما دریافت شد.\n\nاکنون می‌توانید متن توضیحات (کپشن) مورد نظرتان را بفرستید یا در صورت تمایل، دکمه ثبت بدون کپشن را انتخاب کنید:",
                        reply_markup: { inline_keyboard: [
                            [{ text: 'ثبت بدون کپشن', callback_data: 'no_caption' }],
                            [{ text: 'لغو و بازگشت به پنل', callback_data: 'cancel' }]
                        ]}
                    }, env);
                }
            }

            if (state === 'UPLOAD_SINGLE_CAPTION') {
                const temp = JSON.parse(userData.temp_data);
                const caption = text || message.caption || "";
                const uid = generateRandomString(8);
                const finalData = { file_id: temp.file_id, file_unique_id: temp.file_unique_id, file_type: temp.type, caption };
                
                await saveFileEntry(uid, 'single', finalData, env);
                await setUser(from_id, 'NONE', '', env);
                
                const botUser = (await bot('getMe', {}, env)).result.username;
                await bot('sendMessage', { chat_id, text: `فایل با موفقیت در سیستم آپلود شد.\n\nلینک دسترسی:\nhttps://t.me/${botUser}?start=${uid}`, parse_mode: 'Markdown' }, env);
                return await showAdminPanel(chat_id, adminRole, null, env);
            }

            if (state === 'UPLOAD_MULTI' || state === 'UPLOAD_MULTI_CAPTION') {
                const file = getFileInfo(message);
                
                if (file) {
                    file.message_id = message.message_id;
                    file.caption = message.caption || "";
                    let temp = userData.temp_data ? JSON.parse(userData.temp_data) : { index: 0, files: [] };
                    temp.files.push(file);

                    if (state === 'UPLOAD_MULTI') {
                        await setUser(from_id, 'UPLOAD_MULTI_CAPTION', JSON.stringify(temp), env);
                        return await askForMultiCaption(chat_id, file.message_id, temp.index, env);
                    } else {
                        if (temp.index === temp.files.length - 1) {
                            await setUser(from_id, 'UPLOAD_MULTI_CAPTION', JSON.stringify(temp), env);
                            return await askForMultiCaption(chat_id, file.message_id, temp.index, env);
                        } else {
                            await setUser(from_id, 'UPLOAD_MULTI_CAPTION', JSON.stringify(temp), env);
                            return; 
                        }
                    }
                } else if (text && state === 'UPLOAD_MULTI_CAPTION') {
                    let temp = userData.temp_data ? JSON.parse(userData.temp_data) : null;
                    if (temp && temp.index < temp.files.length) {
                        temp.files[temp.index].caption = text;
                        temp.index++;
                        await setUser(from_id, 'UPLOAD_MULTI_CAPTION', JSON.stringify(temp), env);

                        if (temp.index < temp.files.length) {
                            return await askForMultiCaption(chat_id, temp.files[temp.index].message_id, temp.index, env);
                        } else {
                            return await bot('sendMessage', {
                                chat_id,
                                text: "کپشن این فایل ثبت شد. فایل دیگری در صف نمانده. می‌توانید فایل‌های جدید بفرستید یا بارگذاری را تمام کنید:",
                                reply_markup: { inline_keyboard: [[{ text: 'اتمام بارگذاری', callback_data: 'multi_finish' }]] }
                            }, env);
                        }
                    }
                }
            }

            if (state === 'MANAGE_SEARCH') {
                let foundId = text;
                const entry = await getFileEntry(foundId, env);
                if (entry) {
                    await setUser(from_id, 'NONE', foundId, env);
                    return await bot('sendMessage', {
                        chat_id,
                        text: `مشخصات فایل پیدا شده:\n\nشناسه فایل: \`${foundId}\`\nنوع ذخیره‌سازی: ${entry.type}`,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [
                            [{ text: 'حذف این فایل', callback_data: `del_${foundId}` }],
                            [{ text: 'بازگشت', callback_data: 'home' }]
                        ]}
                    }, env);
                }
                return await bot('sendMessage', { chat_id, text: "متأسفانه فایلی با این شناسه پیدا نشد." }, env);
            }
        }

        if (text && text.startsWith('/start ')) {
            const uid = text.split(' ')[1];
            
            const channels = await getChannels(env);
            let notJoined = false;
            let keys = [];
            
            for (let i = 0; i < channels.length; i++) {
                const chn = channels[i];
                const res = await bot('getChatMember', { chat_id: chn, user_id: from_id }, env);
                const status = res.result ? res.result.status : '';
                
                if (!['member', 'administrator', 'creator'].includes(status)) {
                    const chat = await bot('getChat', { chat_id: chn }, env);
                    let link = chat.result && chat.result.username ? `https://t.me/${chat.result.username}` : (chat.result ? chat.result.invite_link : "");
                    
                    if (!link) {
                        const exportLink = await bot('exportChatInviteLink', { chat_id: chn }, env);
                        link = exportLink.result || "#";
                    }
                    keys.push([{ text: `ورود به کانال شماره ${i+1}`, url: link }]);
                    notJoined = true;
                }
            }

            if (notJoined) {
                const botInfo = await bot('getMe', {}, env);
                keys.push([{ text: "تایید عضویت و دریافت فایل", url: `https://t.me/${botInfo.result.username}?start=${uid}` }]);
                return await bot('sendMessage', { chat_id, text: "برای دریافت فایل درخواستی، ابتدا باید در کانال‌های زیر عضو شوید. پس از عضویت، دکمه تایید را بزنید:", parse_mode: 'Markdown', reply_markup: { inline_keyboard: keys } }, env);
            }

            const reactChan = await getSetting('reaction_channel_link', env);
            if (reactChan) {
                const currentTime = Math.floor(Date.now() / 1000);
                const cbData = `check_rxn_${uid}_${currentTime}`;
                const msgText = `کاربر گرامی، برای نهایی‌سازی دریافت فایل، لطفاً به ۵ تا ۱۰ پست آخر کانال زیر واکنش (ریکشن) نشان دهید و سپس روی دکمه بررسی و تایید کلیک کنید.\n\nکانال مورد نظر: ${reactChan}`;
                return await bot('sendMessage', {
                    chat_id, text: msgText,
                    reply_markup: { inline_keyboard: [[{ text: 'بررسی و تایید انجام کار', callback_data: cbData }]] }
                }, env);
            }

            return await processSendFile(chat_id, uid, env, ctx);
        } else if (!isAdmin) {
            return await bot('sendMessage', { chat_id, text: "سلام. وقت بخیر. برای دریافت فایل، لطفاً از روی لینک اختصاصی که در اختیار دارید وارد شوید." }, env);
        }
    }

    if (update.callback_query) {
        const cb = update.callback_query;
        const chat_id = cb.message.chat.id;
        const from_id = cb.from.id;
        const message_id = cb.message.message_id;
        const data = cb.data;

        const userData = await getUser(from_id, env);

        if (data.startsWith('check_rxn_')) {
            const parts = data.split('_');
            const fileUid = parts[2];
            const timestamp = parseInt(parts[3]);
            const diff = Math.floor(Date.now() / 1000) - timestamp;

            if (diff < 23) {
                return await bot('answerCallbackQuery', { callback_query_id: cb.id, text: "لطفاً ابتدا مراحل ذکر شده را با دقت انجام دهید و سپس مجدداً این دکمه را برای تایید فشار دهید.", show_alert: true }, env);
            } else {
                await bot('answerCallbackQuery', { callback_query_id: cb.id }, env);
                await bot('deleteMessage', { chat_id, message_id }, env);
                return await processSendFile(chat_id, fileUid, env, ctx);
            }
        }

        const adminRole = await getAdminRole(from_id, env);
        if (adminRole !== false) {
            if (data === 'home' || data === 'cancel') {
                await setUser(from_id, 'NONE', '', env);
                return await showAdminPanel(chat_id, adminRole, message_id, env);
            }

            if (data.startsWith('setrole_') && adminRole === 'owner') {
                const parts = data.split('_');
                const roleType = parts[1];
                const newAdminId = parts[2];
                await addAdmin(newAdminId, roleType, env);
                const roleName = roleType === 'uploader' ? "آپلودر" : "با دسترسی کامل";
                await setUser(from_id, 'NONE', null, env);
                return await bot('editMessageText', { chat_id, message_id, text: `ادمین جدید با شناسه عددی (${newAdminId}) و سطح دسترسی **${roleName}** با موفقیت در سیستم ثبت شد.`, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'بازگشت به پنل', callback_data: 'home' }]] } }, env);
            }

            if (data === 'stats' && (adminRole === 'owner' || adminRole === 'full')) {
                const users = await getAllUsersID(env);
                return await bot('answerCallbackQuery', { callback_query_id: cb.id, text: `تعداد کل کاربران ثبت شده در ربات: ${users.length} نفر`, show_alert: true }, env);
            }

            if (data === 'upl_single') {
                await setUser(from_id, 'UPLOAD_SINGLE', null, env);
                return await bot('editMessageText', { chat_id, message_id, text: "بخش آپلود تکی فعال شد.\nلطفاً فایل مد نظر خود را برای ربات بفرستید:", parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'بازگشت به پنل', callback_data: 'home' }]] } }, env);
            }

            if (data === 'no_caption' && userData.step === 'UPLOAD_SINGLE_CAPTION') {
                const temp = JSON.parse(userData.temp_data);
                const uid = generateRandomString(8);
                const finalData = { file_id: temp.file_id, file_unique_id: temp.file_unique_id, file_type: temp.type, caption: "" };
                await saveFileEntry(uid, 'single', finalData, env);
                await setUser(from_id, 'NONE', '', env);
                
                const botUser = (await bot('getMe', {}, env)).result.username;
                await bot('deleteMessage', { chat_id, message_id }, env);
                await bot('sendMessage', { chat_id, text: `فایل بدون کپشن با موفقیت ذخیره شد.\n\nلینک اختصاصی شما:\nhttps://t.me/${botUser}?start=${uid}`, parse_mode: 'Markdown' }, env);
                return await showAdminPanel(chat_id, adminRole, null, env);
            }

            if (data === 'upl_multi') {
                await setUser(from_id, 'UPLOAD_MULTI', JSON.stringify({ index: 0, files: [] }), env);
                return await bot('editMessageText', { chat_id, message_id, text: "بخش آپلود گروهی فعال شد.\nلطفاً فایل‌های خود را بفرستید. سیستم پس از دریافت، دقیقاً روی هر فایل ریپلای زده و از شما متن کپشن را می‌خواهد:", parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'اتمام بارگذاری', callback_data: 'multi_finish' }], [{ text: 'بازگشت به پنل', callback_data: 'home' }]] } }, env);
            }

            if (data === 'multi_skip_one') {
                let temp = JSON.parse(userData.temp_data);
                if (temp && temp.index < temp.files.length) {
                    temp.index++;
                    await setUser(from_id, 'UPLOAD_MULTI_CAPTION', JSON.stringify(temp), env);
                    await bot('deleteMessage', { chat_id, message_id }, env);
                    
                    if (temp.index < temp.files.length) {
                        return await askForMultiCaption(chat_id, temp.files[temp.index].message_id, temp.index, env);
                    } else {
                        return await bot('sendMessage', { chat_id, text: "از کپشن این فایل گذشتیم. فایل دیگری در صف نیست. می‌توانید فایل جدید بفرستید یا بارگذاری را تمام کنید:", reply_markup: { inline_keyboard: [[{ text: 'اتمام بارگذاری', callback_data: 'multi_finish' }]] } }, env);
                    }
                }
            }

            if (data === 'multi_skip_all') {
                let temp = JSON.parse(userData.temp_data);
                temp.index = temp.files.length;
                await setUser(from_id, 'UPLOAD_MULTI_CAPTION', JSON.stringify(temp), env);
                await bot('deleteMessage', { chat_id, message_id }, env);
                return await bot('sendMessage', { chat_id, text: "کپشن‌دهی برای تمامی فایل‌های صف لغو شد. جهت دریافت لینک آلبوم روی دکمه زیر کلیک کنید:", reply_markup: { inline_keyboard: [[{ text: 'اتمام بارگذاری', callback_data: 'multi_finish' }]] } }, env);
            }

            if (data === 'multi_finish') {
                const temp = userData.temp_data ? JSON.parse(userData.temp_data) : { files: [] };
                const batch = temp.files || [];
                
                if (batch.length === 0) return await bot('answerCallbackQuery', { callback_query_id: cb.id, text: "هیچ فایلی برای ذخیره‌سازی فرستاده نشده است.", show_alert: true }, env);
                
                const uid = generateRandomString(8);
                await saveFileEntry(uid, 'batch', { files: batch }, env);
                await setUser(from_id, 'NONE', '', env);
                
                const botUser = (await bot('getMe', {}, env)).result.username;
                await bot('deleteMessage', { chat_id, message_id }, env);
                await bot('sendMessage', { chat_id, text: `آلبوم فایل‌ها با موفقیت ایجاد و ذخیره شد.\n\nلینک اختصاصی دریافت:\nhttps://t.me/${botUser}?start=${uid}`, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'بازگشت به پنل', callback_data: 'home' }]] } }, env);
                return;
            }

            if (data === 'man_search') {
                await setUser(from_id, 'MANAGE_SEARCH', null, env);
                return await bot('editMessageText', { chat_id, message_id, text: "جهت جستجو یا حذف، لطفاً شناسه فایل مورد نظر را ارسال کنید:", parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'بازگشت به پنل', callback_data: 'home' }]] } }, env);
            }

            if (data.startsWith('del_') && !data.includes('react') && !data.includes('chan') && !data.includes('admin')) {
                const idToDelete = data.substring(4);
                await deleteFileEntry(idToDelete, env);
                await bot('answerCallbackQuery', { callback_query_id: cb.id, text: "فایل مورد نظر با موفقیت حذف شد.", show_alert: true }, env);
                await setUser(from_id, 'NONE', null, env);
                return await showAdminPanel(chat_id, adminRole, message_id, env);
            }

            if (data === 'broadcast' && (adminRole === 'owner' || adminRole === 'full')) {
                await setUser(from_id, 'WAITING_BROADCAST', null, env);
                return await bot('editMessageText', { chat_id, message_id, text: "بخش ارسال همگانی فعال شد.\nلطفاً پیام خود را بفرستید تا برای همه کاربران ارسال شود:", reply_markup: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'home' }]] } }, env);
            }

            if (data === 'settings' && (adminRole === 'owner' || adminRole === 'full')) {
                let keys = [];
                if (adminRole === 'owner') keys.push([{ text: 'افزودن ادمین جدید', callback_data: 'add_admin' }, { text: 'حذف ادمین', callback_data: 'rem_admin' }]);
                keys.push([{ text: 'مدیریت قفل واکنش', callback_data: 'reaction_lock' }], [{ text: 'مدیریت کانال‌های عضویت اجباری', callback_data: 'chans' }], [{ text: 'بازگشت', callback_data: 'home' }]);
                return await bot('editMessageText', { chat_id, message_id, text: "تنظیمات پیشرفته سیستم:", parse_mode: 'Markdown', reply_markup: { inline_keyboard: keys } }, env);
            }

            if (data === 'add_admin' && adminRole === 'owner') {
                await setUser(from_id, 'WAITING_NEW_ADMIN', null, env);
                return await bot('editMessageText', { chat_id, message_id, text: "لطفاً شناسه عددی (User ID) کاربر مورد نظر برای ارتقا به مدیریت را ارسال کنید:", parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'settings' }]] } }, env);
            }

            if (data === 'rem_admin' && adminRole === 'owner') {
                const admins = await getSubAdminsWithRoles(env);
                let keys = [];
                admins.forEach(adm => {
                    if (adm.user_id !== env.MAIN_ADMIN.toString()) keys.push([{ text: `حذف: ${adm.user_id} (${adm.role})`, callback_data: `deladmin_${adm.user_id}` }]);
                });
                keys.push([{ text: 'بازگشت', callback_data: 'settings' }]);
                return await bot('editMessageText', { chat_id, message_id, text: "لیست ادمین‌ها. برای حذف هر ادمین، روی گزینه مربوط به آن کلیک کنید:", reply_markup: { inline_keyboard: keys } }, env);
            }

            if (data.startsWith('deladmin_') && adminRole === 'owner') {
                const target = data.substring(9);
                await removeAdmin(target, env);
                await bot('answerCallbackQuery', { callback_query_id: cb.id, text: "کاربر از لیست ادمین‌ها خارج شد.", show_alert: true }, env);
                return await bot('editMessageText', { chat_id, message_id, text: "تغییرات با موفقیت اعمال شد و دسترسی کاربر لغو گردید.", reply_markup: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'settings' }]] } }, env);
            }

            if (data === 'chans' && (adminRole === 'owner' || adminRole === 'full')) {
                const channels = await getChannels(env);
                let keys = channels.map(chn => [{ text: `حذف کانال: ${chn}`, callback_data: `delchan_${chn}` }]);
                keys.push([{ text: 'افزودن کانال جدید', callback_data: 'add_chan_wait' }], [{ text: 'بازگشت', callback_data: 'settings' }]);
                return await bot('editMessageText', { chat_id, message_id, text: "لیست کانال‌های متصل به سیستم عضویت اجباری:", parse_mode: 'Markdown', reply_markup: { inline_keyboard: keys } }, env);
            }

            if (data === 'add_chan_wait') {
                return await bot('editMessageText', {
                    chat_id, message_id,
                    text: "لطفاً نوع کانالی که می‌خواهید اضافه کنید را مشخص نمایید:",
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        [{ text: 'کانال عمومی (روش فوروارد)', callback_data: 'mode_chan_public' }],
                        [{ text: 'کانال خصوصی (ثبت دستی)', callback_data: 'mode_chan_private' }],
                        [{ text: 'بازگشت', callback_data: 'settings' }]
                    ]}
                }, env);
            }

            if (data === 'mode_chan_public') {
                await setUser(from_id, 'WAITING_CHANNEL', null, env);
                return await bot('editMessageText', { chat_id, message_id, text: "لطفاً یک پیام از کانال عمومی مد نظرتان را به این صفحه فوروارد کنید.\n\nتوجه: برای بررسی وضعیت عضویت کاربران، حتماً ربات را از قبل در آن کانال به عنوان مدیر اضافه کنید.", parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'settings' }]] } }, env);
            }

            if (data === 'mode_chan_private') {
                await setUser(from_id, 'WAITING_PRIVATE_LINK', null, env);
                return await bot('editMessageText', { chat_id, message_id, text: "لطفاً ابتدا لینک دعوت کانال خصوصی را بفرستید.\n\nتوجه: حتماً ربات باید در آن کانال دسترسی مدیریت داشته باشد تا فرآیند کار به درستی انجام شود.", parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'settings' }]] } }, env);
            }

            if (data.startsWith('delchan_')) {
                await removeChannel(data.substring(8), env);
                await bot('answerCallbackQuery', { callback_query_id: cb.id, text: "کانال انتخاب شده با موفقیت حذف شد.", show_alert: true }, env);
                return await bot('editMessageText', { chat_id, message_id, text: "لیست کانال‌ها با موفقیت به‌روزرسانی شد.", reply_markup: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'chans' }]] } }, env);
            }

            if (data === 'reaction_lock' && (adminRole === 'owner' || adminRole === 'full')) {
                const curr = await getSetting('reaction_channel_link', env);
                const txt = `تنظیمات قفل واکنش (ریکشن):\n\n${curr ? `لینک فعلی کانال ریکشن: ${curr}` : "در حال حاضر هیچ لینکی ثبت نشده است."}`;
                let keys = [[{ text: 'ثبت لینک جدید', callback_data: 'set_react_link' }]];
                if (curr) keys.push([{ text: 'حذف لینک واکنش', callback_data: 'del_react_link' }]);
                keys.push([{ text: 'بازگشت', callback_data: 'settings' }]);
                return await bot('editMessageText', { chat_id, message_id, text: txt, reply_markup: { inline_keyboard: keys } }, env);
            }

            if (data === 'set_react_link') {
                await setUser(from_id, 'WAITING_REACTION_LINK', null, env);
                return await bot('editMessageText', { chat_id, message_id, text: "لطفاً لینک کانال مد نظرتان را برای قفل واکنش (ریکشن) ارسال کنید:", reply_markup: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'settings' }]] } }, env);
            }

            if (data === 'del_react_link') {
                await deleteSetting('reaction_channel_link', env);
                await bot('answerCallbackQuery', { callback_query_id: cb.id, text: "لینک واکنش با موفقیت حذف شد.", show_alert: true }, env);
                return await bot('editMessageText', { chat_id, message_id, text: "تنظیمات ذخیره شد و لینک واکنش برداشته شد.", reply_markup: { inline_keyboard: [[{ text: 'بازگشت', callback_data: 'settings' }]] } }, env);
            }
        }
    }
}
