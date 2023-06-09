import * as dotenv from 'dotenv'
dotenv.config()

import Discord from 'discord.js'
import { ChatGPTAPI } from 'chatgpt'

import fs from 'fs'
import path from 'path';

const client = new Discord.Client();

client.on("ready", () => {
  console.log(`Ready! Logged in as ${client.user.tag}`);
  client.user.setActivity(`uwu`);
});

let conversation = {
  parentMessageId: null
};

const api = new ChatGPTAPI({
  apiKey: process.env.OPENAI_API_KEY
})

client.on("message", async message => {

  if (message.channel.id == process.env.CHANNELID) {
    console.log
    if (message.author.bot) return;
    if (!message.content) return;

    try {

      // Ignore messages starting with !!
      if (message.content.startsWith("!!")) {
        return;
      }

      message.channel.startTyping();

      // Reset conversation
      if (message.content.startsWith("%reset")) {
        conversation.parentMessageId = null;
        message.channel.send("Conversation reset.");
        message.channel.stopTyping();
        return;
      }
      // Print conversation ID and parent message ID
      if (message.content.startsWith("%debug")) {
        message.channel.send("parentMessageId: " + conversation.parentMessageId);
        message.channel.stopTyping();
        return;
      } 

      var parentid = conversation.parentMessageId
      const res = await api.sendMessage(message.content, {
        parentMessageId: parentid
      });


      // Filter @everyone and @here
      if (res.text.includes(`@everyone`)) {
        message.channel.stopTyping();
        return message.channel.send(`**[FILTERED]**`);
      }
      if (res.text.includes(`@here`)) {
        message.channel.stopTyping();
        return message.channel.send(`**[FILTERED]**`);
      }

      // Handle long responses
      if (res.text.length >= 2000) {
        fs.writeFileSync(path.resolve('./how.txt'), res.text);
        message.channel.send('how', { files: ["./how.txt"] });
        message.channel.stopTyping();
        return;
      }


      message.channel.send(`${res.text}`);
      conversation.parentMessageId = res.parentMessageId;
      message.channel.stopTyping();

    } catch (error) {
      console.log(error)
      message.channel.stopTyping();
      return message.channel.send(`\`${error}\``);
    }

  }
});

client.login(process.env.DISCORD);
