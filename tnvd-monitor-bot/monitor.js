const express = require('express')
const axios = require('axios')
const cron = require('node-cron');
const bodyParser = require('body-parser');
const _ = require('lodash')
const { JsonDB } = require('node-json-db');
const { Config } = require('node-json-db/dist/lib/JsonDBConfig');
const TelegramBot = require('node-telegram-bot-api');
const app = express()
const port = 31410

app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

const botToken = '5594912240:AAGOy9jcxlsH8Ykg4Cy_oNiom5EjzbNjM2Y';
const botChatId = '-1001562565824'
const supervisorId = 307584770
const bot = new TelegramBot(botToken, {polling: true});

const noRefetch = Boolean(process.argv.find(arg => arg === '--no-refetch'))

const db = new JsonDB(new Config("/home/sadmin/tnvd-monitor-bot"));

const serverURL = "https://corp.tknovosib.ru"
const hookSecret = "ixcap2akjh2wbky8"
const TnvdFieldId = "UF_CRM_1600310015"

const initialApiURL = `${serverURL}/rest/1/${hookSecret}/crm.deal.list.json`
const apiURL = `${serverURL}/rest/1/${hookSecret}/crm.deal.get.json`

const fetchInitialData = async function(isActualise) {
  let start = 0;
  while (typeof start !== 'undefined') {
    let params = {
      'select[]': TnvdFieldId,
      start
    }
    if (isActualise) {
      let date = new Date()
      date.setDate(date.getDate() - 1);
      params['FILTER[>DATE_MODIFY]'] = date.toLocaleDateString("ru").replace(/\//g,'.');
    }
    let res = await axios.get(initialApiURL, {
      params
    })
    start = res.data.next

    res.data.result.forEach(order => {
      let id = order["ID"]
      let currentTnvd
      let newTnvd = order[TnvdFieldId]
      try {
        currentTnvd = db.getData(`/${id}`)
        if (!_.isEqual(currentTnvd, newTnvd)) {
          db.push(`/${id}`, newTnvd)
          sendNotification(id, Array.from(newTnvd))
        }
      } catch(error) {
        db.push(`/${id}`, newTnvd)
      }
    })
    if (start) {
      console.log(`🔍 Loaded ${start} items...`);
    }
  }
}
const checkField = async function(id, isUpdate) {
  console.log(`🥁 Checking ${id}...`)
  let res = await axios.get(apiURL, {
    params: {
      'ID': id,
    }
  })
  let currentTnvd
  let newTnvd = res.data.result[TnvdFieldId]
  try { // если есть в базе
    currentTnvd = db.getData(`/${id}`)
    if (!_.isEqual(currentTnvd, newTnvd)) { // если тнвэды не равны
      if (_.isEqual(newTnvd, [])) {
        sendNotification(id, newTnvd, "removed")
      } else {
        sendNotification(id, newTnvd, "new")
      }
      db.push(`/${id}`, newTnvd)
    } else { // если тнвэды равны
      console.log(`🔕 Tnvd is not updated, skipping`)
    }
  } catch(error) { // если нет в базе
    if (_.isEqual(newTnvd, [])) {
      sendNotification(id, newTnvd, "add") // Если добавленое новое, и нет кода
    } else {
      sendNotification(id, newTnvd, "new") // Если добалено новое и код есть
    }
    db.push(`/${id}`, newTnvd)
    console.log(`🧲 Tnvd is not present, adding to database`)
  }
  
}

const sendNotification = function(id, code, type) {
  console.log(`🔔 Sending notification with ID ${id}`)
  switch (type) {
    case 'add': 
      bot.sendMessage(botChatId, `⭕️ Требуется код ТНВЭД по сделке (${id}) \n #тебуетсякод`);
      break
    case 'new': 
      bot.sendMessage(botChatId, `✅ Присвоен код ТНВЭД по сделке (${id}), новый код: "${code.join(', ')}" \n #присвоенкод`);
      break
    case 'removed':
      bot.sendMessage(botChatId, `⛔️ Удалён код ТНВЭД по сделке (${id}) \n #удаленкод`);
      break
  }
}

app.post('/bitrixhook', async (req, res) => {
  if (req.body.event === 'ONCRMDEALUPDATE' || req.body.event === 'ONCRMDEALADD') {
    await checkField(req.body.data['FIELDS']['ID'], req.body.event === 'ONCRMDEALUPDATE')
    res.send('OK')
  }
})

app.listen(port, async () => {
  bot.sendMessage(supervisorId, `🌐 Бот ТНВД перезапускается...`);
  if (!noRefetch) {
    console.log(`📀 Starting initial loading...`)
    await fetchInitialData()
    console.log('\n🚀 Initial loading complete')
  }
  console.log(`🌐 Starting webhook server on port ${port}...`)
})

cron.schedule('0 0 * * *', async () => {
  console.log(`📀 Starting scheduled loading...`)
  await fetchInitialData(true)
  console.log('\n🚀 Scheduled loading complete')
});
