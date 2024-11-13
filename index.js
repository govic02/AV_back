const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const FormData = require('form-data');
const config = require('./config.js');
const mongoose = require('mongoose');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const { registrarJardin, registrarJardinDesdeChat } = require('./controllers/jardinController');
const { guardarConversacion } = require('./controllers/conversacionController');

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('Conectado a MongoDB'))
  .catch((err) => console.error('Error al conectar a MongoDB:', err));

const BASE_INSTRUCTIONS = `
Eres el asistente experto de la empresa Áreas Verdes. Estás encargado de recepcionar mensajes desde WhatsApp para hacer registros de avance en el proceso de mantención de áreas verdes en la municipalidad de Punta Arenas.
Debes tener siempre en cuenta:
- Ser amigable.
- Responder de manera precisa sin extenderte mucho.
- Para realizar un registro, debes obtener del usuario la siguiente información: cuadrante, observaciones, plaza o área verde a mantener, y una o más imágenes relacionadas con el mantenimiento.
- **Acepta y procesa la información en cualquier orden en que el usuario la proporcione.**
- **Acumula la información proporcionada hasta que tengas todos los datos necesarios para el registro.**
- **Cuando el usuario proporcione cualquier nuevo dato, debes llamar a la función "registrarJardin" con los datos proporcionados para actualizar el registro pendiente.**
- Si aún falta información, solicita al usuario los datos faltantes de manera clara y amable.
- Cuando tengas toda la información requerida, muestra al usuario los datos que se van a guardar y solicita confirmación antes de proceder.
- Si el usuario desea modificar algún dato antes de confirmar el registro, llama a la función "modificarRegistro" con el campo y el nuevo valor proporcionados por el usuario.
- Si el usuario confirma el registro, llama a la función "confirmarRegistro" para guardar el registro pendiente.
- Una vez que el registro ha sido confirmado y guardado, no se puede modificar.
- **Si el usuario solicita información sobre el registro en curso o detalles proporcionados previamente, proporciónale la información almacenada en la conversación o en el registro pendiente sin llamar a funciones adicionales.**
`;

const conversations = new Map();
const pendingRegistrations = new Map();

const functions = [
  {
    name: 'registrarJardin',
    description: 'Registra o actualiza un jardín con los datos proporcionados',
    parameters: {
      type: 'object',
      properties: {
        cuadrante: { type: 'string', description: 'El cuadrante del jardín' },
        plaza: { type: 'string', description: 'El nombre de la plaza o área verde' },
        observaciones: { type: 'string', description: 'Observaciones sobre el mantenimiento' },
        images: { type: 'array', items: { type: 'string' }, description: 'Lista de nombres de archivos de imágenes asociadas' },
      },
      required: [],
    },
  },
  {
    name: 'modificarRegistro',
    description: 'Modifica los datos del registro pendiente antes de confirmarlo',
    parameters: {
      type: 'object',
      properties: {
        campo: { type: 'string', description: 'El campo a modificar (cuadrante, plaza, observaciones, images)' },
        valor: { type: 'string', description: 'El nuevo valor para el campo' },
      },
      required: ['campo', 'valor'],
    },
  },
  {
    name: 'confirmarRegistro',
    description: 'Confirma y guarda el registro pendiente',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

async function getLLMResponse(chatId, userMessage, numeroTelefono) {
  try {
    if (!userMessage) {
      return 'Lo siento, no he recibido ningún texto para procesar.';
    }

    if (!conversations.has(chatId)) {
      conversations.set(chatId, []);
    }
    const conversation = conversations.get(chatId);

    conversation.push({ role: 'user', content: userMessage });
    await guardarConversacion(numeroTelefono, { role: 'user', content: userMessage });

    const messages = [
      { role: 'system', content: BASE_INSTRUCTIONS },
      ...conversation,
    ];

    if (pendingRegistrations.has(chatId)) {
      const pendingData = pendingRegistrations.get(chatId);
      messages.push({
        role: 'system',
        content: `Datos del registro pendiente:\n${JSON.stringify(pendingData)}`,
      });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4-0613',
      messages,
      functions,
      function_call: 'auto',
    });

    const assistantMessage = response.choices[0].message;

    console.log('Assistant message:', assistantMessage);

    if (assistantMessage.content) {
      conversation.push(assistantMessage);
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: assistantMessage.content });
    }

    if (assistantMessage.function_call) {
      const functionName = assistantMessage.function_call.name;
      const functionArgs = assistantMessage.function_call.arguments
        ? JSON.parse(assistantMessage.function_call.arguments)
        : {};
      return await handleFunctionCall(chatId, functionName, functionArgs, conversation, numeroTelefono);
    }

    return assistantMessage.content;
  } catch (error) {
    console.error('Error en getLLMResponse:', error);
    return 'Lo siento, ha ocurrido un error al procesar tu mensaje.';
  }
}

async function handleFunctionCall(chatId, functionName, functionArgs, conversation, numeroTelefono) {
  if (functionName === 'registrarJardin') {
    let registro = pendingRegistrations.get(chatId) || {
      cuadrante: '',
      plaza: '',
      observaciones: '',
      images: [],
    };

    registro = {
      ...registro,
      ...functionArgs,
    };

    pendingRegistrations.set(chatId, registro);

    const confirmationRequest = `Has proporcionado la siguiente información:\n` +
      `- Cuadrante: ${registro.cuadrante || 'No proporcionado'}\n` +
      `- Plaza: ${registro.plaza || 'No proporcionado'}\n` +
      `- Observaciones: ${registro.observaciones || 'No proporcionado'}\n` +
      `- Imágenes adjuntadas: ${registro.images.length}\n\n` +
      `Si aún falta información, por favor proporciónala. Cuando estés listo, puedes confirmar el registro.`;

    conversation.push({ role: 'assistant', content: confirmationRequest });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: confirmationRequest });

    return confirmationRequest;
  } else if (functionName === 'confirmarRegistro') {
    if (pendingRegistrations.has(chatId)) {
      const pendingData = pendingRegistrations.get(chatId);

      if (!pendingData.cuadrante || !pendingData.plaza || !pendingData.observaciones || pendingData.images.length === 0) {
        const validationMessage = 'Faltan datos obligatorios para confirmar el registro. Por favor, completa la información necesaria.';
        conversation.push({ role: 'assistant', content: validationMessage });
        await guardarConversacion(numeroTelefono, { role: 'assistant', content: validationMessage });
        return validationMessage;
      }

      await registrarJardinDesdeChat(chatId, pendingData);
      pendingRegistrations.delete(chatId);

      const confirmationMessage = '¡Registro confirmado y guardado exitosamente!';
      conversation.push({ role: 'assistant', content: confirmationMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: confirmationMessage });

      return confirmationMessage;
    } else {
      const noPendingMessage = 'No hay un registro pendiente para confirmar.';
      conversation.push({ role: 'assistant', content: noPendingMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: noPendingMessage });

      return noPendingMessage;
    }
  } else if (functionName === 'modificarRegistro') {
    return modifyPendingRegistration(chatId, functionArgs, conversation, numeroTelefono);
  } else {
    const functionResponse = 'Lo siento, no puedo realizar esa acción.';
    conversation.push({ role: 'assistant', content: functionResponse });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: functionResponse });

    return functionResponse;
  }
}

async function modifyPendingRegistration(chatId, functionArgs, conversation, numeroTelefono) {
  if (pendingRegistrations.has(chatId)) {
    const pendingData = pendingRegistrations.get(chatId);
    const campo = functionArgs.campo.toLowerCase();
    const valor = functionArgs.valor;

    if (['cuadrante', 'plaza', 'observaciones'].includes(campo)) {
      pendingData[campo] = valor;
      pendingRegistrations.set(chatId, pendingData);

      const modificationMessage = `El campo "${campo}" ha sido actualizado a: ${valor}.\n\n` +
        `Datos actuales del registro:\n` +
        `- Cuadrante: ${pendingData.cuadrante}\n` +
        `- Plaza: ${pendingData.plaza}\n` +
        `- Observaciones: ${pendingData.observaciones}\n` +
        `- Imágenes adjuntadas: ${pendingData.images.length}\n\n` +
        `¿Deseas confirmar este registro? Por favor, responde con una confirmación o indica si deseas modificar otro dato.`;

      conversation.push({ role: 'assistant', content: modificationMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: modificationMessage });

      return modificationMessage;
    } else if (campo === 'images') {
      if (valor.toLowerCase() === 'eliminar todas') {
        pendingData.images = [];
      } else {
        pendingData.images.push(valor);
      }
      pendingRegistrations.set(chatId, pendingData);

      const modificationMessage = `Las imágenes han sido actualizadas.\n\n` +
        `Imágenes adjuntadas: ${pendingData.images.length}\n\n` +
        `¿Deseas confirmar este registro? Por favor, responde con una confirmación o indica si deseas modificar otro dato.`;

      conversation.push({ role: 'assistant', content: modificationMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: modificationMessage });

      return modificationMessage;
    } else {
      const errorMessage = `El campo "${campo}" no es válido. Puedes modificar "cuadrante", "plaza", "observaciones" o "images".`;
      conversation.push({ role: 'assistant', content: errorMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });

      return errorMessage;
    }
  } else {
    const noPendingMessage = 'No hay un registro pendiente para modificar.';
    conversation.push({ role: 'assistant', content: noPendingMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: noPendingMessage });

    return noPendingMessage;
  }
}

async function handleNewMessages(req, res) {
  try {
    const messages = req?.body?.messages;
    for (let message of messages) {
      if (message.from_me) continue;

      const chatId = message.chat_id;
      const numeroTelefono = message.from;

      console.log('Received message:', JSON.stringify(message, null, 2));

      if (message.type === 'text') {
        const messageText = message.text?.body?.trim();
        const responseText = await getLLMResponse(chatId, messageText, numeroTelefono);
        await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
      } else if (message.type === 'image') {
        await handleImageMessage(message, chatId, numeroTelefono);
      } else if (message.type === 'audio' || message.type === 'voice') {
        await handleAudioMessage(message, chatId, numeroTelefono);
      } else {
        const responseText = 'Lo siento, no puedo procesar ese tipo de mensaje.';
        await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
      }
    }
    res.send('Ok');
  } catch (e) {
    console.error('Error en handleNewMessages:', e);
    res.status(500).send(e.message);
  }
}

async function handleImageMessage(message, chatId, numeroTelefono) {
  try {
    const imageInfo = message.image;
    const imageUrl = imageInfo.link;

    if (!imageUrl) {
      const responseText = 'No se pudo obtener el enlace de la imagen.';
      await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
      return;
    }

    const imageData = await downloadImage(imageUrl);
    const imageExtension = imageInfo.mime_type.split('/')[1];
    const imageFileName = `image_${Date.now()}.${imageExtension}`;
    const imagePath = path.join(__dirname, 'images', imageFileName);

    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, imageData);

    let pendingData;
    if (pendingRegistrations.has(chatId)) {
      pendingData = pendingRegistrations.get(chatId);
    } else {
      pendingData = {
        cuadrante: '',
        plaza: '',
        observaciones: '',
        images: [],
      };
    }

    pendingData.images.push(imageFileName);
    pendingRegistrations.set(chatId, pendingData);

    const responseText = 'Imagen recibida y añadida al registro pendiente.';
    await sendWhapiRequest('messages/text', { to: chatId, body: responseText });

    const messageText = 'He enviado una imagen para el registro.';
    const responseTextAssistant = await getLLMResponse(chatId, messageText, numeroTelefono);
    await sendWhapiRequest('messages/text', { to: chatId, body: responseTextAssistant });
  } catch (error) {
    console.error('Error al procesar el mensaje de imagen:', error);
    const responseText = 'Lo siento, ha ocurrido un error al procesar la imagen.';
    await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
  }
}

async function handleAudioMessage(message, chatId, numeroTelefono) {
  try {
    const audioInfo = message.audio || message.voice;
    const audioUrl = audioInfo.link;

    if (!audioUrl) {
      const responseText = 'No se pudo obtener el enlace del audio.';
      await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
      return;
    }

    const audioData = await downloadAudio(audioUrl);

    const mimeType = audioInfo.mime_type.split(';')[0]; // "audio/ogg"
    const audioExtension = mimeType.split('/')[1]; // "ogg"
    const audioFileName = `audio_${Date.now()}.${audioExtension}`;
    const audioPath = path.join(__dirname, 'audios', audioFileName);

    fs.mkdirSync(path.dirname(audioPath), { recursive: true });
    fs.writeFileSync(audioPath, audioData);

    const transcription = await transcribeAudio(audioPath);
    fs.unlinkSync(audioPath);

    if (!transcription) {
      const responseText = 'Lo siento, no pude transcribir el audio.';
      await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
      return;
    }

    const responseText = await getLLMResponse(chatId, transcription, numeroTelefono);
    await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
  } catch (error) {
    console.error('Error al procesar el mensaje de audio:', error);
    const responseText = 'Lo siento, ha ocurrido un error al procesar el audio.';
    await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
  }
}

async function transcribeAudio(audioPath) {
  try {
    const fileStream = fs.createReadStream(audioPath);
    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      language: 'es',
    });

    const transcription = response.text;
    console.log('Transcripción:', transcription);
    return transcription;
  } catch (error) {
    console.error('Error al transcribir el audio:', error);
    return null;
  }
}

async function downloadAudio(url) {
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
    });
    return response.data;
  } catch (error) {
    throw new Error(`Error al descargar el audio: ${error.message}`);
  }
}

async function downloadImage(url) {
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
    });
    return response.data;
  } catch (error) {
    throw new Error(`Error al descargar la imagen: ${error.message}`);
  }
}

async function sendWhapiRequest(endpoint, params = {}, method = 'POST') {
  let options = {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  };

  if (params?.media) {
    options.body = toFormData(params);
  } else {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(params);
  }

  const url = `${config.apiUrl}/${endpoint}`;
  const response = await fetch(url, options);
  const json = await response.json();
  console.log('Whapi response:', JSON.stringify(json, null, 2));
  return json;
}

function toFormData(obj) {
  const form = new FormData();
  for (let key in obj) {
    form.append(key, obj[key]);
  }
  return form;
}

async function setHook() {
  if (config.botUrl) {
    const settings = {
      webhooks: [
        {
          url: config.botUrl,
          events: [{ type: 'messages', method: 'post' }],
          mode: 'method',
        },
      ],
    };
    await sendWhapiRequest('settings', settings, 'PATCH');
  }
}

const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => res.send('Bot is running'));
app.post('/hook/messages', handleNewMessages);

setHook().then(() => {
  const port = config.port || (config.botUrl.indexOf('https:') === 0 ? 443 : 80);
  app.listen(port, () => console.log(`Listening on port ${port}...`));
});
