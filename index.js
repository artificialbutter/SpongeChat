import * as dotenv from 'dotenv'
dotenv.config()

import { Client, GatewayIntentBits } from 'discord.js'

import fs from 'fs'
import path from 'path';

import axios from 'axios';
import { decode } from 'html-entities';

import { pipeline } from '@xenova/transformers';


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  allowedMentions: { parse: [], repliedUser: false }
});

client.on("ready", async () => {
  console.log(`Ready! Logged in as ${client.user.tag}`);
  client.user.setActivity(`uwu`);
});

let history = { internal: [], visible: [] };

async function sendChat(userInput, history) {
  const request = {
    user_input: userInput,
    max_new_tokens: 200,
    auto_max_new_tokens: false,
    max_tokens_second: 0,
    history: history,
    mode: 'chat',
    character: 'SpongeAss-Bot',
    your_name: 'discord user',
    regenerate: false,
    _continue: false,
    chat_instruct_command:
      'Continue the chat dialogue below. Write a single reply for the character "<|character|>"\n\n<|prompt|>',
    preset: 'None',
    do_sample: true,
    temperature: 0.82,
    top_p: 0.21,
    typical_p: 1,
    epsilon_cutoff: 0,
    eta_cutoff: 0,
    tfs: 1,
    top_a: 0,
    repetition_penalty: 1.19,
    repetition_penalty_range: 0,
    top_k: 72,
    min_length: 0,
    no_repeat_ngram_size: 0,
    num_beams: 1,
    penalty_alpha: 0,
    length_penalty: 1,
    early_stopping: true,
    mirostat_mode: 0,
    mirostat_tau: 5,
    mirostat_eta: 0.1,
    guidance_scale: 1,
    negative_prompt: '',

    seed: -1,
    add_bos_token: true,
    truncation_length: 2048,
    ban_eos_token: false,
    skip_special_tokens: true,
    stopping_strings: [],
  };

  try {
    const response = await axios.post(process.env.LOCAL_AI_URL, request);

    if (response.status === 200) {
      const result = response.data.results[0].history;

      // Combine the existing history with the new visibleHistory
      history.internal = result.internal;
      history.visible = result.visible;

      return decode(result.visible[result.visible.length - 1][1]);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

let localAIenabled = false;

async function makeRequest() {
  try {
    const response = await axios.get(process.env.LOCAL_AI_URL);

    if (response.status === 200) {
      localAIenabled = true;
    }
  } catch (error) {
    if (error.response.status === 404) {
      localAIenabled = true;
      return;
    };
    console.log(`\nCannot access local AI (non 404 code)\n`);
    localAIenabled = false;
  }
};


async function checkLocalAI() {
  let localAIenabledprev = localAIenabled;

  // Set a 20-second timeout
  const timeoutId = setTimeout(() => {
    localAIenabled = false;
    console.log(`\nCannot access local AI (timeout)\n`);
  }, 20000);

  await makeRequest()
    .then(() => {
      clearTimeout(timeoutId);
    })
    .catch((error) => {
      console.error('Error in makeRequest:', error);
    });
  if (localAIenabledprev != localAIenabled) {
    if (localAIenabled) {
      console.log("🔌 SpongeGPT connected!");
    } else {
      console.log("🔌 SpongeGPT disconnected.");
    }
  }
}

checkLocalAI();

// Check every minute if the local AI is enabled
setInterval(() => {
  checkLocalAI();
}, 60000);

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.content) return;

  if (message.channel.id == process.env.CHANNELID || message.channel.id == process.env.CHANNELID2) {

    try {

      // Ignore messages starting with !!
      if (message.content.startsWith("!!")) {
        return;
      }

      // Handle conversation reset and debug commands
      if (message.content.startsWith("%reset")) {
        history = { internal: [], visible: [] };
        message.reply("♻️ Conversation history reset.");
        return;
      }
      if (message.content.startsWith("%debug")) {
        message.reply("no debug info available");
        return;
      }


      let imageDetails = '';
      if (message.attachments.size > 0) {

        let captioner = await pipeline('image-to-text', 'Xenova/vit-gpt2-image-captioning');

        for (const attachment of message.attachments.values()) {
          try {
            let url = attachment.url;
            let output = await captioner(url);


            imageDetails = imageDetails + `Attached: image of ${output[0].generated_text}\n`;
          } catch (error) {
            console.error(error);
            return message.reply(`❌ Error! Yell at arti.`);
          };
        }

      }


      // Send user input to AI and receive response
      let res;
      if (localAIenabled) {
        let chatResponse;
        if (message.reference) {
          await message.fetchReference().then(async (reply) => {
            chatResponse = await sendChat(`> ${reply}\n${message.author.username}: ${message.content}\n\n${imageDetails}`, history);
          });
        } else {
          chatResponse = await sendChat(`${message.author.username}: ${message.content}\n\n${imageDetails}`, history);
        }

        res = { text: chatResponse };
      } else {
        message.reply(`⚠️ SpongeGPT is currently unreachable, try again later!`);
        return;
      }

      // Handle long responses
      if (res.text.length >= 2000) {
        fs.writeFileSync(path.resolve('./how.txt'), res.text);
        message.reply({ content: "", files: ["./how.txt"] });
        return;
      }

      // Send AI response
      message.reply(`${res.text}`);

    } catch (error) {
      console.error(error);
      return message.reply(`❌ Error! Yell at arti.`);
    }

  }
});

client.login(process.env.DISCORD);
