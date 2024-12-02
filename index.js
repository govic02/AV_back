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
const { Mutex } = require('async-mutex');
require('dotenv').config();
const Jardin = require('./models/Jardin');
const { registrarJardin, registrarJardinDesdeChat } = require('./controllers/jardinController');
const { guardarConversacion } = require('./controllers/conversacionController');
const whapi = require('@api/whapi');
const mondaySdk = require('monday-sdk-js')();
const { Readable } = require('stream');
const Cuadrante = require('./models/Cuadrante'); // Ajusta la ruta según tu estructura
const Programa = require('./models/Programa');
const UsuariosTelefono = require('./models/UsuariosTelefono');
process.on('unhandledRejection', (err) => {
  ////console.error('Unhandled Rejection:', err);
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    ////console.log('Conectado a MongoDB');
    return ;
  })
  .catch((err) => console.error('Error al conectar a MongoDB:', err));

const operatorNumbers = [
  '56944962650','56994308142','56982992248','56968275302' ];// Reemplaza con los números de teléfono de operadores


const administratorNumbers = ['56963542290','56996401135','56990151534','56946389165']; // Reemplaza con los números de teléfono de administradores


whapi.server('https://gate.whapi.cloud');
whapi.auth('04xueyYUN6IZR2ANc9ekeamQPY2cH3XZ');
const cuadrantesData = [
  {}
];


async function populateCuadrantes() {
  try {
    ////console.log('🔄 Iniciando la inicialización de cuadrantes...');

    for (const data of cuadrantesData) {
      const cuadranteExistente = await Cuadrante.findOne({ cuadrante: data.cuadrante });

      if (!cuadranteExistente) {
        // Crear un nuevo cuadrante si no existe
        const nuevoCuadrante = new Cuadrante(data);
        await nuevoCuadrante.save();
        ////console.log(`✅ ${data.cuadrante} creado con las plazas asociadas.`);
      } else {
        // Actualizar las plazas del cuadrante existente
        cuadranteExistente.plazas = data.plazas;
        await cuadranteExistente.save();
        ////console.log(`📝 ${data.cuadrante} actualizado con nuevas plazas.`);
      }
    }

    ////console.log('✅ Inicialización de cuadrantes completada.');
  } catch (error) {
    ////console.error('❌ Error al inicializar cuadrantes:', error);
  }
}


const BASE_INSTRUCTIONS_OPERATOR = `
Eres el asistente experto de la empresa Áreas Verdes. Estás encargado de recepcionar mensajes desde WhatsApp para realizar registros y consultas relacionados con el mantenimiento de áreas verdes y programas de la municipalidad de Punta Arenas.

Tu función principal es ayudar a los usuarios a:
- Registrar nuevos **Jardines** o **Programas**.
- Proporcionar información o consultas sobre registros existentes.

Para ello, debes:
- Interpretar las solicitudes del usuario en lenguaje natural.
- Solicitar los datos necesarios si falta información.
- Confirmar con el usuario antes de proceder con registros o acciones importantes.

**Registro de Jardín:**
VALIDACIONES IMPORTANTES:
1. Cuadrantes válidos:
   - Solo existen Cuadrante 1, Cuadrante 2, Cuadrante 3 y Cuadrante 4
   - Debes identificar referencias a estos cuadrantes incluso si el usuario los menciona de forma variada
   - Ejemplos válidos: "cuadrante uno", "cuadrante 1", "primer cuadrante", etc.

2. Plazas válidas por cuadrante:
   - Cuadrante 1: Plazas 1 a 66
   - Cuadrante 2: Plazas 1 a 76
   - Cuadrante 3: Plazas 1 a 54
   - Cuadrante 4: Plazas 1 a 94
   - Debes identificar el número de plaza mencionado y validar que esté en el rango correcto

3. Interpretación de mensajes:
   - Interpreta referencias naturales como "estoy en la plaza quince del cuadrante dos"
   - Identifica menciones indirectas como "la plaza número 3" o "plaza tres"
   - Valida que los números identificados estén en los rangos permitidos

4. Manejo de errores:
   - Si el cuadrante mencionado no existe, informa al usuario los cuadrantes válidos
   - Si el número de plaza está fuera de rango, indica el rango válido para ese cuadrante
   - Solicita aclaración cuando la información es ambigua

5. Proceso de registro:
   - Solicita aclaración si la información es incompleta o ambigua
   - Confirma la interpretación con el usuario antes de proceder
   - No realices el registro si hay dudas sobre la validez de los datos

Instrucciones adicionales:
- Ser amigable y profesional
- Responder de manera precisa sin extenderte mucho
- Para realizar un registro, obtener: cuadrante, observaciones, plaza y una o más imágenes
- Acumular la información hasta tener todos los datos necesarios
- Confirmar con el usuario antes de proceder con el registro final

Cuando identifiques un cuadrante y plaza válidos, debes:
1. Normalizar los valores (ej: "Cuadrante 1", "Plaza 15")
2. Verificar que la combinación sea válida
3. Solicitar confirmación al usuario
4. Proceder solo si todos los datos son válidos

EJEMPLOS DE INTERPRETACIÓN:

Usuario: "Estoy en la plaza quince del primer cuadrante"
Interpretación: Cuadrante 1, Plaza 15 (Válido)

Usuario: "Realizando mantenimiento en plaza 80 del cuadrante 2"
Interpretación: Inválido (Plaza 80 excede el límite de 76 para Cuadrante 2)

Usuario: "En la plaza número tres del tercer cuadrante"
Interpretación: Cuadrante 3, Plaza 3 (Válido)

**Registro de Programa:**
Para registrar un nuevo programa, necesitas obtener:
- Fecha (debe obtenerla automáticamente)
- Nombre
- Lugar de referencia
- Categoría
- Imágenes (el usuario las enviará)

Usa los criterios de comprensión de jardines
**Importante:**
- No uses expresiones regulares o coincidencias de palabras clave para determinar la intención del usuario.
- Utiliza tus capacidades de comprensión del lenguaje natural para entender lo que el usuario solicita.
- Si el usuario proporciona información incompleta o ambigua, solicita aclaraciones de manera cortés.
- Mantén la funcionalidad existente y asegúrate de que las respuestas sean amigables y profesionales.
`;

const BASE_INSTRUCTIONS_ADMINISTRATOR = `
Eres un experto en consultas de MongoDB para la base de datos de Áreas Verdes. Tu tarea es interpretar preguntas en lenguaje natural y ejecutar consultas mediante la función consultarRegistros.

TIPOS DE CONSULTAS:

1. CONSULTAS POR FECHA:
   Cuando el usuario pregunte por registros de una fecha específica, debes llamar a consultarRegistros con:
   {
     tipo: "fecha",
     criterios: {
       fecha: "YYYY-MM-DD",  // Formato ISO de la fecha
       tipo: "dia"           // "dia" para fecha específica, "mes" para mes completo
     }
   }

   Ejemplos:
   - "¿Qué registros hay del 14 de noviembre?" → Usar fecha: "2024-11-14", tipo: "dia"
   - "Mostrar registros de noviembre" → Usar fecha: "2024-11", tipo: "mes"

2. CONSULTAS ESPECÍFICAS:
   Para búsquedas exactas o parciales:
   {
     tipo: "especifica",
     criterios: {
       campo: "cuadrante/plaza/observaciones/telefono",
       valor: "término de búsqueda",
       exacto: true/false
     }
   }

3. BÚSQUEDAS DE TEXTO:
   Para búsquedas en observaciones:
   {
     tipo: "texto",
     criterios: {
       palabrasClave: ["palabra1", "palabra2"],
       operador: "OR"/"AND"
     }
   }

4. LISTADOS:
   Para resúmenes o listados:
   {
     tipo: "listado",
     criterio: "cuadrante/plaza"
   }

IMPORTANTE:
- SIEMPRE debes llamar a la función consultarRegistros con los parámetros adecuados
- NO devuelvas el JSON como texto, usa la función
- Para fechas, convierte el lenguaje natural a formato ISO (YYYY-MM-DD)
- Maneja variaciones en la forma de expresar fechas (ej: "14 de noviembre", "14/11", "noviembre 14")

EJEMPLOS DE USO:

Usuario: "¿Qué registros hay del 14 de noviembre?"
Acción: Llamar a consultarRegistros({
  tipo: "fecha",
  criterios: {
    fecha: "2024-11-14",
    tipo: "dia"
  }
})

Usuario: "Muestra los trabajos de pavimento"
Acción: Llamar a consultarRegistros({
  tipo: "texto",
  criterios: {
    palabrasClave: ["pavimento"],
    operador: "OR"
  }
})

NO DEBES:
- Devolver el JSON como texto en el mensaje
- Ignorar las consultas por fecha
- Usar el formato antiguo de criterio/valor para consultas temporales

DEBES:
- Interpretar las fechas del lenguaje natural
- Convertir al formato ISO
- Llamar a la función con los parámetros correctos
- Manejar casos donde la fecha no esté completa (usar valores por defecto del año actual)

IMPORTANTE:
- ANALIZA el contexto de la conversación antes de decidir si necesitas una nueva consulta
- USA la información existente cuando sea necesario, porque te estén preguntando por la información recientemente consultada y entregada
- REALIZA nuevas consultas solo cuando sea necesario
- MANTÉN la conversación fluida y natural
- EXPLICA brevemente por qué estás usando datos existentes o haciendo una nueva consulta

Ejemplos de uso:

Usuario: "¿Qué registros hay de la Plaza 19?"
Acción: NUEVA CONSULTA - No hay información previa
{
  tipo: "especifica",
  criterios: {
    campo: "plaza",
    valor: "Plaza 19"
  }
}

Usuario: "¿Cuántas imágenes tiene el último registro que me mostraste?"
Acción: USAR CONTEXTO - La información ya está disponible

Usuario: "¿En qué otros cuadrantes hay registros?"
Acción: NUEVA CONSULTA - Se necesita información adicional
{
  tipo: "listado",
  criterio: "cuadrante"
}

Usuario: "De los registros que me mostraste, ¿cuál es el más reciente?"
Acción: USAR CONTEXTO - Analizar fechas de los registros mostrados

RECUERDA:
- Prioriza la eficiencia usando datos existentes cuando sea posible
- Explica tu razonamiento brevemente
- Mantén las respuestas claras y concisas

// CUANDO TE PREGUNTEN SOBRE METROS CUADRADOS
CONSULTAS DE METROS CUADRADOS:
Eres un experto en interpretar consultas sobre metros cuadrados trabajados por operadores. 

COMPRENSIÓN DE CONSULTAS:
1. Debes identificar:
   - QUIÉN: El nombre del operador sobre quien se consulta
   - CUÁNDO: El período de tiempo de la consulta
   - QUÉ: La métrica solicitada (metros cuadrados)

2. Ejemplos de variaciones en consultas:
   "¿Cuántos metros cuadrados lleva José Urrutia hoy?"
   "¿Cuánto ha trabajado Carlos esta semana?"
   "Metros avanzados por María desde ayer"
   "¿Qué área cubrió Pedro hoy?"
   "Total de superficie mantenida por Juan esta mañana"

3. Interpretación temporal:
   - "hoy" → Día actual
   - "esta semana" → Semana en curso
   - "ayer" → Día anterior
   - "este mes" → Mes en curso
   - Referencias específicas como "desde el lunes"

Cuando identifiques una consulta sobre metros cuadrados, debes llamar a la función 
'consultarMetrosCuadrados' con los siguientes parámetros:

{
  tipo: "metros_cuadrados",
  criterios: {
    nombreOperador: string,    // Nombre identificado del operador
    periodoTipo: string,       // "dia", "semana", "mes", "rango"
    fechaInicio: Date,         // Fecha inicial del período
    fechaFin: Date,            // Fecha final del período
    formatoRespuesta: string   // "detallado" o "resumen"
  }
}

EJEMPLOS DE INTERPRETACIÓN:

Usuario: "¿Cuántos metros cuadrados lleva José Urrutia hoy?"
Interpretación y llamada:
{
  tipo: "metros_cuadrados",
  criterios: {
    nombreOperador: "José Urrutia",
    periodoTipo: "dia",
    fechaInicio: [fecha actual 00:00],
    fechaFin: [fecha actual 23:59],
    formatoRespuesta: "detallado"
  }
}

Usuario: "¿Cuánto ha trabajado Carlos esta semana?"
Interpretación y llamada:
{
  tipo: "metros_cuadrados",
  criterios: {
    nombreOperador: "Carlos",
    periodoTipo: "semana",
    fechaInicio: [inicio de semana],
    fechaFin: [fin de semana],
    formatoRespuesta: "resumen"
  }
}

PROCESAMIENTO DE RESULTADOS:
Cuando recibas los resultados de la consulta, debes:

1. Para respuesta detallada:
   - Mostrar total de metros cuadrados
   - Listar cada registro con fecha, plaza y metros
   - Incluir observaciones relevantes
   - Calcular promedios si es período extenso

2. Para respuesta resumida:
   - Mostrar total de metros cuadrados
   - Indicar número de áreas trabajadas
   - Mencionar período cubierto

3. Manejo de casos especiales:
   - Sin registros encontrados
   - Operador no encontrado
   - Períodos sin actividad

FORMATO DE RESPUESTA:
Estructura tus respuestas de manera clara y profesional:

📊 Resumen de trabajo de [Operador]
📅 Período: [especificar período]
🏗️ Total metros cuadrados: [total]m²
📝 Registros procesados: [cantidad]

[Si es detallado, incluir lista de registros]
1. [Fecha] - [Plaza]
   📏 [Metros]m²
   📝 [Observaciones]

[Si aplica, incluir estadísticas]
📈 Promedio diario: [valor]m²
🎯 Mayor área en un día: [valor]m²

COMPRENSIÓN DE CONSULTAS TEMPORALES:
1. Referencias temporales específicas:
   - "hoy" → periodoTipo: "dia"
   - "ayer" → periodoTipo: "ayer"
   - "antes de ayer" → periodoTipo: "antesdeayer"
   - "esta semana" → periodoTipo: "semana"
   - "este mes" → periodoTipo: "mes"
   - "del [fecha] al [fecha]" → periodoTipo: "rango", incluir fechaInicio y fechaFin
    - "noviembre u otro mes de 2024 u otro año" → periodoTipo: "rango", incluir fechaInicio y fechaFin

2. Ejemplos de consultas:
   "¿Cuántos metros cuadrados hizo Juan ayer?"
   → {
     nombreOperador: "Juan",
     periodoTipo: "ayer",
     formatoRespuesta: "resumen"
   }

   "¿Qué área cubrió Pedro antes de ayer?"
   → {
     nombreOperador: "Pedro",
     periodoTipo: "antesdeayer",
     formatoRespuesta: "detallado"
   }

   "¿Cuántos metros trabajó María del 15 al 20 de noviembre?"
   → {
     nombreOperador: "María",
     periodoTipo: "rango",
     fechaInicio: "2023-11-15",
     fechaFin: "2023-11-20",
     formatoRespuesta: "resumen"
   }
 Eres un experto en consultas de programas registrados en la base de datos de Áreas Verdes. Tu tarea es interpretar preguntas en lenguaje natural y ejecutar consultas mediante la función \`consultarProgramas\`.

    **TIPOS DE CONSULTAS:**

    1. **CONSULTAS POR FECHA:**
       Cuando el usuario pregunte por programas de una fecha específica, debes llamar a \`consultarProgramas\` con:
       \`\`\`json
       {
         "tipo": "fecha",
         "criterios": {
           "fecha": "YYYY-MM-DD",  // Formato ISO de la fecha
           "tipo": "dia"           // "dia" para fecha específica, "mes" para mes completo
         }
       }
       \`\`\`

    2. **CONSULTAS ESPECÍFICAS:**
       Para búsquedas exactas o parciales:
       \`\`\`json
       {
         "tipo": "especifica",
         "criterios": {
           "campo": "nombre/lugarDeReferencia/categoria",
           "valor": "término de búsqueda",
           "exacto": true/false
         }
       }
       \`\`\`

    3. **BÚSQUEDAS DE TEXTO:**
       Para búsquedas en campos de texto:
       \`\`\`json
       {
         "tipo": "texto",
         "criterios": {
           "palabrasClave": ["palabra1", "palabra2"],
           "operador": "OR"/"AND"
         }
       }
       \`\`\`

    4. **LISTADOS:**
       Para resúmenes o listados:
       \`\`\`json
       {
         "tipo": "listado",
         "criterio": "categoria"
       }
       \`\`\`

    **IMPORTANTE:**

    - SIEMPRE debes llamar a la función \`consultarProgramas\` con los parámetros adecuados.
    - NO devuelvas el JSON como texto, usa la función.
    - Para fechas, convierte el lenguaje natural a formato ISO (YYYY-MM-DD).
    - Maneja variaciones en la forma de expresar fechas (ej: "14 de noviembre", "14/11", "noviembre 14").

    **EJEMPLOS DE USO:**

    Usuario: "¿Qué programas hay del 14 de noviembre?"
    Acción: Llamar a \`consultarProgramas\`:
    \`\`\`json
    {
      "tipo": "fecha",
      "criterios": {
        "fecha": "2024-11-14",
        "tipo": "dia"
      }
    }
    \`\`\`

    Usuario: "Muestra los programas de cultura"
    Acción: Llamar a \`consultarProgramas\`:
    \`\`\`json
    {
      "tipo": "especifica",
      "criterios": {
        "campo": "categoria",
        "valor": "cultura",
        "exacto": false
      }
    }
    \`\`\`
`;



const conversations = new Map();
const pendingRegistrations = new Map();
const userMutexes = new Map();
async function inicializarUsuarios() {
  try {
    const usuarios = [
      {
        nombre: 'Nicolas G',
        numeroTelefono: '56963542290',
        rol: 'operator',
        activo: true
      }
    ];

    for (const usuario of usuarios) {
      // Verificar si el usuario ya existe
      const usuarioExistente = await UsuariosTelefono.findOne({ numeroTelefono: usuario.numeroTelefono });
      
      if (!usuarioExistente) {
        // Crear nuevo usuario si no existe
        await UsuariosTelefono.create(usuario);
        ////console.log(`✅ Usuario creado: ${usuario.nombre} (${usuario.numeroTelefono})`);
      } else {
        // Actualizar usuario existente
        await UsuariosTelefono.findOneAndUpdate(
          { numeroTelefono: usuario.numeroTelefono },
          usuario,
          { new: true }
        );
        ////console.log(`📝 Usuario actualizado: ${usuario.nombre} (${usuario.numeroTelefono})`);
      }
    }

    ////console.log('✅ Inicialización de usuarios completada');

    // Actualizar arrays de operadores y administradores
    const operadores = await UsuariosTelefono.find({ rol: 'operator', activo: true });
    const administradores = await UsuariosTelefono.find({ rol: 'administrator', activo: true });

    // Actualizar las constantes globales
    operatorNumbers.length = 0;
    administratorNumbers.length = 0;

    operatorNumbers.push(...operadores.map(op => op.numeroTelefono));
    administratorNumbers.push(...administradores.map(admin => admin.numeroTelefono));

    ////console.log('📱 Números de operadores:', operatorNumbers);
    ////console.log('👑 Números de administradores:', administratorNumbers);

  } catch (error) {
    ////console.error('❌ Error al inicializar usuarios:', error);
  }
}

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
        images: { type: 'array', items: { type: 'object' }, description: 'Lista de nombres de archivos de imágenes asociadas' },
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
  {
    name: 'consultarRegistros',
    description: 'Consulta registros de jardines según diferentes criterios',
    parameters: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['fecha', 'especifica', 'texto', 'listado'],
          description: 'Tipo de consulta a realizar'
        },
        criterios: {
          type: 'object',
          properties: {
            fecha: {
              type: 'string',
              description: 'Fecha en formato YYYY-MM-DD para consultas por fecha'
            },
            tipo: {
              type: 'string',
              enum: ['dia', 'mes'],
              description: 'Tipo de consulta por fecha (día específico o mes completo)'
            },
            campo: {
              type: 'string',
              enum: ['cuadrante', 'plaza', 'observaciones'],
              description: 'Campo para consultas específicas'
            },
            valor: {
              type: 'string',
              description: 'Valor a buscar en consultas específicas'
            },
            palabrasClave: {
              type: 'array',
              items: { type: 'string' },
              description: 'Lista de palabras clave para búsqueda en texto'
            },
            operador: {
              type: 'string',
              enum: ['OR', 'AND'],
              description: 'Operador para combinar palabras clave'
            }
          }
        }
      },
      required: ['tipo']
    }
  },
  {
    name: 'consultarMetrosCuadrados',
    description: 'Consulta los metros cuadrados trabajados por un operador en un período específico',
    parameters: {
      type: 'object',
      properties: {
        nombreOperador: { 
          type: 'string', 
          description: 'Nombre del operador a consultar' 
        },
        periodoTipo: { 
          type: 'string',
          enum: ['dia', 'semana', 'mes', 'rango'],
          description: 'Tipo de período a consultar'
        },
        fechaInicio: { 
          type: 'string', 
          description: 'Fecha de inicio del período (ISO 8601)' 
        },
        fechaFin: { 
          type: 'string', 
          description: 'Fecha de fin del período (ISO 8601)' 
        },
        formatoRespuesta: { 
          type: 'string',
          enum: ['detallado', 'resumen'],
          description: 'Formato de la respuesta'
        }
      },
      required: ['nombreOperador', 'periodoTipo']
    }
  },
  {
    name: 'registrarPrograma',
    description: 'Registra un nuevo programa con los datos proporcionados',
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'El nombre del programa' },
        lugarDeReferencia: { type: 'string', description: 'El lugar de referencia del programa' },
        categoria: { type: 'string', description: 'La categoría del programa' },
        images: { type: 'array', items: { type: 'object' }, description: 'Lista de imágenes asociadas' },
      },
      required: ['nombre', 'lugarDeReferencia', 'categoria'],
    },
  },
  {
    name: 'modificarRegistroPrograma',
    description: 'Modifica los datos del registro de programa pendiente antes de confirmarlo',
    parameters: {
      type: 'object',
      properties: {
        campo: { type: 'string', description: 'El campo a modificar (nombre, lugarDeReferencia, categoria, images)' },
        valor: { type: 'string', description: 'El nuevo valor para el campo' },
      },
      required: ['campo', 'valor'],
    },
  },
  {
    name: 'confirmarRegistroPrograma',
    description: 'Confirma y guarda el registro de programa pendiente',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'consultarProgramas',
    description: 'Consulta programas registrados según diferentes criterios',
    parameters: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['fecha', 'especifica', 'texto', 'listado'],
          description: 'Tipo de consulta a realizar'
        },
        criterios: {
          type: 'object',
          properties: {
            fecha: {
              type: 'string',
              description: 'Fecha en formato YYYY-MM-DD para consultas por fecha'
            },
            tipo: {
              type: 'string',
              enum: ['dia', 'mes'],
              description: 'Tipo de consulta por fecha (día específico o mes completo)'
            },
            campo: {
              type: 'string',
              enum: ['nombre', 'lugarDeReferencia', 'categoria'],
              description: 'Campo para consultas específicas'
            },
            valor: {
              type: 'string',
              description: 'Valor a buscar en consultas específicas'
            },
            palabrasClave: {
              type: 'array',
              items: { type: 'string' },
              description: 'Lista de palabras clave para búsqueda en texto'
            },
            operador: {
              type: 'string',
              enum: ['OR', 'AND'],
              description: 'Operador para combinar palabras clave'
            }
          }
        }
      },
      required: ['tipo']
    }
  }
];
async function sendImage(chatId, base64Image, mimeType = 'image/jpeg', width = 100, height = 100, caption = 'Imágenes Registradas') {
  try {
    const response = await whapi.sendMessageImage({
      to: chatId, //
      media: `data:${mimeType};base64,${base64Image}`,
      mime_type: mimeType,
      width: 100, 
      height: 100, 
      caption: caption
    });
    ////console.log('Imagen enviada con éxito:', response.data);
  } catch (error) {
    ////console.error('Error al enviar imagen:', error.message, error.data);
  }
}
async function getMondayColumnIds() {
  try {
    const query = `query {
      boards(ids: ${process.env.MONDAY_BOARD_ID}) {
        columns {
          id
          title
          type
        }
      }
    }`;

    const response = await mondaySdk.api(query);
    ////console.log('📊 Estructura de columnas:', response.data.boards[0].columns);
    return response.data.boards[0].columns;
  } catch (error) {
    ////console.error('❌ Error al obtener IDs de columnas:', error);
    throw error;
  }
}
async function createMondayItem(data) {
  try {
    ////console.log('📝 Creando ítem en Monday.com:', data);
    
    // 1. Validar datos de entrada
    if (!data.cuadrante || !data.plaza || !data.observaciones || !data.numeroTelefono) {
      throw new Error('Datos incompletos para crear ítem');
    }

    // 2. Buscar usuario por número de teléfono
    try {
      const usuario = await UsuariosTelefono.findOne({ numeroTelefono: data.numeroTelefono });
      if (usuario && usuario.nombre) {
        data.nombreUsuario = usuario.nombre;
        ////console.log(`🔍 Usuario encontrado: ${data.nombreUsuario}`);
      } else {
        data.nombreUsuario = 'Usuario no registrado';
        ////console.warn(`⚠️ No se encontró un usuario válido para el número: ${data.numeroTelefono}`);
      }
    } catch (userError) {
      ////console.error('❌ Error al buscar usuario:', userError);
      data.nombreUsuario = 'Error al buscar usuario';
    }

    // 3. Inicializar SDK de Monday.com
    mondaySdk.setToken(process.env.MONDAY_API_TOKEN);

    // 4. Crear ítem base en Monday.com
    const itemName = `Mantención ${data.plaza} - ${data.nombreUsuario}`;
    ////console.log('🔄 Creando ítem base con itemName:', itemName);
    
    const createMutation = `mutation($boardId: ID!, $itemName: String!) {
      create_item(
        board_id: $boardId,
        item_name: $itemName
      ) {
        id
      }
    }`;

    const createVariables = {
      boardId: process.env.MONDAY_BOARD_ID,
      itemName: itemName
    };

    const createResponse = await mondaySdk.api(createMutation, { variables: createVariables });

    if (createResponse.errors) {
      throw new Error(`Error al crear ítem: ${JSON.stringify(createResponse.errors)}`);
    }

    const itemId = createResponse.data.create_item.id;
    ////console.log('✅ Ítem base creado:', itemId);

    // 5. Definir actualizaciones de columnas con formato correcto
    const columnUpdates = [
      { 
        columnId: 'texto_corto__1', 
        value: JSON.stringify(data.cuadrante)
      },
      { 
        columnId: 'texto_corto0__1', 
        value: JSON.stringify(data.plaza)
      },
      { 
        columnId: 'texto_corto07__1', 
        value: JSON.stringify(data.observaciones)
      },
      { 
        columnId: 'tel_fono__1', 
        value: JSON.stringify({
          "phone": data.numeroTelefono,
          "countryShortName": "CL"
        })
      },
      { 
        columnId: 'fecha__1', 
        value: JSON.stringify({
          "date": data.fecha || new Date().toISOString().split('T')[0]
        })
      },
      { 
        columnId: 'texto__1', 
        value: JSON.stringify(data.nombreUsuario)
      }
    ];

    // 6. Actualizar cada columna
    ////console.log('🔄 Actualizando columnas...');
    
    for (const update of columnUpdates) {
      const updateMutation = `mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          board_id: $boardId,
          item_id: $itemId,
          column_id: $columnId,
          value: $value
        ) {
          id
        }
      }`;

      const updateVariables = {
        boardId: process.env.MONDAY_BOARD_ID,
        itemId: itemId,
        columnId: update.columnId,
        value: update.value
      };

      ////console.log(`📝 Actualizando columna ${update.columnId}:`, update.value);
      
      const updateResponse = await mondaySdk.api(updateMutation, { variables: updateVariables });
      if (updateResponse.errors) {
        ////console.error(`⚠️ Error en columna ${update.columnId}:`, updateResponse.errors);
      } else {
        ////console.log(`✅ Columna ${update.columnId} actualizada`);
      }
    }

    // 7. Subir imágenes si existen
    if (data.images && data.images.length > 0) {
      ////console.log('📸 Procesando imágenes...');
      for (const image of data.images) {
        try {
          const fileUploadMutation = `mutation($file: File!) {
            add_file_to_column(
              item_id: ${itemId},
              column_id: "cargar_archivo__1",
              file: $file
            ) {
              id
            }
          }`;

          const fileUploadVariables = {
            file: image
          };

          ////console.log('🔄 Subiendo imagen...');
          const fileUploadResponse = await mondaySdk.api(fileUploadMutation, { variables: fileUploadVariables });
          
          if (fileUploadResponse.errors) {
            ////console.error('⚠️ Error al subir imagen:', fileUploadResponse.errors);
          } else {
            ////console.log('✅ Imagen subida exitosamente');
          }
        } catch (imageError) {
          ////console.error('❌ Error al procesar imagen:', imageError);
        }
      }
    }

    // 8. Verificar resultado final
    const verifyQuery = `query {
      items(ids: [${itemId}]) {
        name
        column_values {
          id
          text
          value
        }
      }
    }`;

    const verification = await mondaySdk.api(verifyQuery);
    ////console.log('🔍 Verificación final:', JSON.stringify(verification, null, 2));

    // 9. Registrar en logs
    ////console.log('📋 Registro completo:', {
   //   itemId,
    //  usuario: data.nombreUsuario,
   //   telefono: data.numeroTelefono,
   //   plaza: data.plaza,
    //  cuadrante: data.cuadrante,
    //  fecha: data.fecha || new Date().toISOString(),
   //   imagenesProcesadas: data.images ? data.images.length : 0
    //});

    // 10. Retornar resultado
    return {
      success: true,
      data: {
        create_item: {
          id: itemId
        }
      },
      verification: verification.data,
      metadata: {
        usuario: data.nombreUsuario,
        telefono: data.numeroTelefono,
        fechaCreacion: new Date().toISOString(),
        imagenesProcesadas: data.images ? data.images.length : 0
      }
    };

  } catch (error) {
    ////console.error('❌ Error en createMondayItem:', error);
    ////console.error('Stack:', error.stack);
    throw new Error(`Error al crear ítem en Monday: ${error.message}`);
  }
}
async function consultarMetrosCuadrados(criterios) {
  try {
    const { nombreOperador, periodoTipo, formatoRespuesta, fechaInicio: fechaInicioParam, fechaFin: fechaFinParam } = criterios;
    
    ////console.log('🔍 Buscando operador:', nombreOperador);
    ////console.log('📅 Tipo de período:', periodoTipo);

    // Calcular fechas según el periodoTipo
    let fechaInicio, fechaFin;

    if (fechaInicioParam && fechaFinParam) {
      fechaInicio = new Date(fechaInicioParam);
      fechaInicio.setHours(0, 0, 0, 0);
      fechaFin = new Date(fechaFinParam);
      fechaFin.setHours(23, 59, 59, 999);
    } else {
      const ahora = new Date();
    
      switch (periodoTipo) {
        case 'semana':
          fechaInicio = new Date(ahora);
          fechaInicio.setDate(ahora.getDate() - ahora.getDay());
          fechaInicio.setHours(0, 0, 0, 0);
  
          fechaFin = new Date(fechaInicio);
          fechaFin.setDate(fechaInicio.getDate() + 6);
          fechaFin.setHours(23, 59, 59, 999);
          break;
  
        case 'dia':
          fechaInicio = new Date();
          fechaInicio.setHours(0, 0, 0, 0);
          fechaFin = new Date();
          fechaFin.setHours(23, 59, 59, 999);
          break;
  
        case 'ayer':
          fechaInicio = new Date(ahora);
          fechaInicio.setDate(ahora.getDate() - 1);
          fechaInicio.setHours(0, 0, 0, 0);
          fechaFin = new Date(fechaInicio);
          fechaFin.setHours(23, 59, 59, 999);
          break;
  
        case 'antesdeayer':
          fechaInicio = new Date(ahora);
          fechaInicio.setDate(ahora.getDate() - 2);
          fechaInicio.setHours(0, 0, 0, 0);
          fechaFin = new Date(fechaInicio);
          fechaFin.setHours(23, 59, 59, 999);
          break;
  
        case 'mes':
          fechaInicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
          fechaInicio.setHours(0, 0, 0, 0);
          fechaFin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
          fechaFin.setHours(23, 59, 59, 999);
          break;
  
        case 'rango':
          if (fechaInicioParam && fechaFinParam) {
            fechaInicio = new Date(fechaInicioParam);
            fechaInicio.setHours(0, 0, 0, 0);
            fechaFin = new Date(fechaFinParam);
            fechaFin.setHours(23, 59, 59, 999);
          } else {
            throw new Error('Para consultas por rango se requieren fechas de inicio y fin');
          }
          break;
  
        default:
          fechaInicio = new Date();
          fechaInicio.setHours(0, 0, 0, 0);
          fechaFin = new Date();
          fechaFin.setHours(23, 59, 59, 999);
      }
    }
   

    ////console.log('📅 Período de búsqueda:', {
   //   inicio: fechaInicio.toISOString(),
  //    fin: fechaFin.toISOString(),
 //     tipo: periodoTipo
  //  });

    // Buscar usuario
    const usuario = await UsuariosTelefono.findOne({
      $or: [
        { nombre: nombreOperador },
        { nombre: { $regex: `^${nombreOperador}$`, $options: 'i' } },
        { nombre: { $regex: nombreOperador.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), $options: 'i' } },
        { nombre: { $regex: nombreOperador.split(' ')[0], $options: 'i' } }
      ],
      activo: true
    });

    ////console.log('👤 Usuario encontrado:', usuario);

    if (!usuario) {
      return {
        success: false,
        message: `No se encontró un operador activo que coincida con "${nombreOperador}"`
      };
    }
    // Buscar registros del período
    const registros = await Jardin.find({
      numeroTelefono: usuario.numeroTelefono,
      createdAt: {
        $gte: fechaInicio,
        $lte: fechaFin
      }
    }).sort({ createdAt: 1 });

    //console.log(`📊 Registros encontrados: ${registros.length}`);

    // Definir el texto del período según el tipo
    const periodoTexto = (() => {
      switch (periodoTipo) {
        case 'semana': return 'esta semana';
        case 'dia': return 'hoy';
        case 'ayer': return 'ayer';
        case 'antesdeayer': return 'antes de ayer';
        case 'mes': return 'este mes';
        case 'rango': return `del ${fechaInicio.toLocaleDateString()} al ${fechaFin.toLocaleDateString()}`;
        default: return 'en el período consultado';
      }
    })();

    if (registros.length === 0) {
      return {
        success: true,
        message: `No se encontraron registros para ${usuario.nombre} ${periodoTexto}`,
        datos: {
          operador: usuario.nombre,
          periodo: `${fechaInicio.toLocaleDateString()} - ${fechaFin.toLocaleDateString()}`,
          registros: [],
          totalMetros: 0
        }
      };
    }

    // Procesar registros y calcular metros cuadrados
    const detalleRegistros = await Promise.all(registros.map(async (registro) => {
      try {
        // Normalizar el número de cuadrante (eliminar "Cuadrante" si existe)
        const numeroCuadrante = registro.cuadrante.replace(/[^0-9]/g, '');
        
        //console.log(`🔍 Buscando cuadrante: ${numeroCuadrante}`);
        
        const cuadrante = await Cuadrante.findOne({ 
          cuadrante: { $regex: new RegExp(`^(Cuadrante\\s*)?${numeroCuadrante}$`, 'i') }
        });
    
        if (!cuadrante) {
          //console.log(`⚠️ No se encontró el cuadrante ${numeroCuadrante}`);
          return {
            fecha: registro.createdAt,
            cuadrante: registro.cuadrante,
            plaza: registro.plaza,
            metrosCuadrados: 0,
            observaciones: registro.observaciones,
            error: 'Cuadrante no encontrado'
          };
        }
    
        // Extraer el número de plaza del registro
        let numeroPlaza;
        if (registro.plaza.includes('Plaza') || registro.plaza.includes('Plazoleta')) {
          // Si es un nombre completo, buscar por dirección
          const plazaEncontrada = cuadrante.plazas.find(p => 
            p.direccion.toLowerCase().includes(registro.plaza.toLowerCase()) ||
            (p.tipoAreaVerde.toLowerCase() + ' ' + p.numero) === registro.plaza.toLowerCase()
          );
          numeroPlaza = plazaEncontrada ? plazaEncontrada.numero : null;
        } else {
          // Si es solo un número
          numeroPlaza = parseInt(registro.plaza.replace(/[^0-9]/g, ''));
        }
    
        //console.log(`🔍 Buscando plaza número ${numeroPlaza} en cuadrante ${numeroCuadrante}`);
    
        const plaza = cuadrante.plazas.find(p => p.numero === numeroPlaza);
    
        if (!plaza) {
          //console.log(`⚠️ No se encontró la plaza ${numeroPlaza} en cuadrante ${numeroCuadrante}`);
          return {
            fecha: registro.createdAt,
            cuadrante: registro.cuadrante,
            plaza: registro.plaza,
            metrosCuadrados: 0,
            observaciones: registro.observaciones,
            error: 'Plaza no encontrada'
          };
        }
    
        //console.log(`✅ Plaza encontrada: ${plaza.tipoAreaVerde} ${plaza.numero} - ${plaza.metrosCuadrados}m²`);
    
        return {
          fecha: registro.createdAt,
          cuadrante: registro.cuadrante,
          plaza: `${plaza.tipoAreaVerde} ${plaza.numero}`,
          metrosCuadrados: plaza.metrosCuadrados,
          observaciones: registro.observaciones,
          direccion: plaza.direccion
        };
      } catch (error) {
        //console.error(`❌ Error procesando registro:`, error);
        return {
          fecha: registro.createdAt,
          cuadrante: registro.cuadrante,
          plaza: registro.plaza,
          metrosCuadrados: 0,
          observaciones: registro.observaciones,
          error: error.message
        };
      }
    }));

    //console.log('📝 Detalle de registros procesados:', JSON.stringify(detalleRegistros, null, 2));

    const totalMetros = detalleRegistros.reduce((sum, reg) => sum + reg.metrosCuadrados, 0);
    const dias = Math.ceil((fechaFin - fechaInicio) / (1000 * 60 * 60 * 24));
    const promedioDiario = totalMetros / dias;
    const mayorArea = Math.max(...detalleRegistros.map(reg => reg.metrosCuadrados));

    // Construir la respuesta
    let respuesta = formatoRespuesta === 'resumen' ?
      `📊 Resumen de ${usuario.nombre} ${periodoTexto}:\n` +
      `🏗️ Total: ${totalMetros.toLocaleString()}m²\n` +
      `📝 Registros: ${registros.length}\n` +
      `📈 Promedio: ${Math.round(promedioDiario).toLocaleString()}m²/día` :
      `📊 Detalle de ${usuario.nombre} ${periodoTexto}:\n` +
      `🏗️ Total: ${totalMetros.toLocaleString()}m²\n` +
      `📝 Registros: ${registros.length}\n\n` +
      detalleRegistros.map((reg, i) => 
        `${i + 1}. ${reg.plaza} (${reg.cuadrante})\n` +
        `   📏 ${reg.metrosCuadrados.toLocaleString()}m²\n` +
        `   📅 ${reg.fecha.toLocaleDateString()}\n` +
        `   📍 ${reg.direccion || 'Dirección no disponible'}\n` +
        `   📝 ${reg.observaciones}`
      ).join('\n\n');

    // Agregar mensaje si hay registros sin metros cuadrados
    const registrosSinMetros = detalleRegistros.filter(reg => reg.metrosCuadrados === 0);
    if (registrosSinMetros.length > 0) {
      respuesta += '\n\n⚠️ Nota: ' + registrosSinMetros.length + 
        ' registro(s) no tienen metros cuadrados asociados. ' +
        'Esto puede deberse a que no se encontró la plaza en el sistema.';
    }

    return {
      success: true,
      message: respuesta,
      datos: {
        operador: usuario.nombre,
        periodo: periodoTexto,
        registros: detalleRegistros,
        totalMetros,
        promedioDiario,
        mayorArea,
        formatoRespuesta
      }
    };

  } catch (error) {
    //console.error('❌ Error en consultarMetrosCuadrados:', error);
    return {
      success: false,
      message: 'Error al procesar la consulta',
      error: error.message
    };
  }
}

async function verificarCuadrantes() {
  const cuadrantes = await Cuadrante.find({});
  //console.log('Verificación de cuadrantes:');
  cuadrantes.forEach(cuadrante => {
    //console.log(`\nCuadrante ${cuadrante.cuadrante}:`);
    //console.log(`Total plazas: ${cuadrante.plazas.length}`);
    //console.log('Plazas sin metros cuadrados:', 
    //  cuadrante.plazas.filter(p => !p.metrosCuadrados).length);
    //console.log('Ejemplo plaza:', cuadrante.plazas[0]);
  });
}

function isRegistroCompleto(registro) {
  return (
    registro.cuadrante &&
    registro.plaza &&
    registro.observaciones &&
    registro.images &&
    registro.images.length > 0
  );
}
async function testMondayItemCreation() {
  try {
    //console.log('🧪 Iniciando prueba de creación de item...');
    
    mondaySdk.setToken(process.env.MONDAY_API_TOKEN);
    //console.log('🔑 Token establecido');

    // Datos de prueba con formato correcto
    const testData = {
      cuadrante: 'TEST-01',
      plaza: 'Plaza Test 123',
      observaciones: 'Registro automático de prueba - Favor ignorar',
      numeroTelefono: '56912345678',
      nombreUsuario: 'Usuario Test',
      fecha: new Date().toISOString().split('T')[0]
    };

    //console.log('📋 Datos de prueba:', testData);

    // Crear item base
    const createMutation = `mutation($boardId: ID!, $itemName: String!) {
      create_item(
        board_id: $boardId,
        item_name: $itemName
      ) {
        id
      }
    }`;

    const createVariables = {
      boardId: process.env.MONDAY_BOARD_ID,
      itemName: `Test Item ${new Date().getTime()}`
    };

    const createResponse = await mondaySdk.api(createMutation, { variables: createVariables });
    //console.log('✅ Item base creado:', createResponse);

    const itemId = createResponse.data.create_item.id;

    // Actualizar columnas con el formato correcto para cada tipo
    const columnUpdates = [
      { 
        columnId: 'texto_corto__1', 
        value: JSON.stringify(testData.cuadrante)
      },
      { 
        columnId: 'texto_corto0__1', 
        value: JSON.stringify(testData.plaza)
      },
      { 
        columnId: 'texto_corto07__1', 
        value: JSON.stringify(testData.observaciones)
      },
      { 
        columnId: 'tel_fono__1', 
        value: JSON.stringify({
          "phone": testData.numeroTelefono,
          "countryShortName": "CL"
        })
      },
      { 
        columnId: 'fecha__1', 
        value: JSON.stringify({
          "date": testData.fecha
        })
      },
      { 
        columnId: 'texto__1', 
        value: JSON.stringify(testData.nombreUsuario)
      }
    ];

    //console.log('🔄 Actualizando columnas...');
    
    for (const update of columnUpdates) {
      const updateMutation = `mutation($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          board_id: $boardId,
          item_id: $itemId,
          column_id: $columnId,
          value: $value
        ) {
          id
        }
      }`;

      const updateVariables = {
        boardId: process.env.MONDAY_BOARD_ID,
        itemId: itemId,
        columnId: update.columnId,
        value: update.value
      };

      //console.log(`📝 Actualizando columna ${update.columnId}:`, update.value);
      
      const updateResponse = await mondaySdk.api(updateMutation, { variables: updateVariables });
      if (updateResponse.errors) {
        //console.error(`⚠️ Error en columna ${update.columnId}:`, updateResponse.errors);
      } else {
        //console.log(`✅ Columna ${update.columnId} actualizada`);
      }
    }

    // Verificar el resultado
    const verifyQuery = `query {
      items(ids: [${itemId}]) {
        name
        column_values {
          id
          text
          value
        }
      }
    }`;

    const verification = await mondaySdk.api(verifyQuery);
    //console.log('🔍 Verificación final:', JSON.stringify(verification, null, 2));

    return {
      success: true,
      itemId: itemId,
      verification: verification.data
    };

  } catch (error) {
    //console.error('❌ Error en prueba:', error);
    return {
      success: false,
      error: error.message
    };
  }
}



// Ejecutar la prueba al inicio en ambiente de desarrollo




async function sendImagesFromRegistration(chatId, images) {
  for (const image of images) {
    const base64Image = `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`;
    await sendImage(chatId, base64Image);
  }
}

async function verifyMondayColumns() {
  try {
    const columns = await getMondayColumnIds();
    //console.log('Estructura de columnas:');
    columns.forEach(col => {
      //console.log(`- ${col.title}: ID=${col.id}, Type=${col.type}`);
    });
  } catch (error) {
    //console.error('Error al verificar columnas:', error);
  }
}
const MONDAY_COLUMNS = {
  fecha: 'date',
  cuadrante: 'text',
  plaza: 'text',
  observaciones: 'long_text',
  estado: 'status',
  telefono: 'phone'
};
function initializeMondaySdk() {
  try {
    if (!process.env.MONDAY_API_TOKEN) {
      //console.error('ERROR: No se encontró MONDAY_API_TOKEN en las variables de entorno');
      return false;
    }
    
    mondaySdk.setToken(process.env.MONDAY_API_TOKEN);
    //console.log('Monday SDK inicializado correctamente');
    return true;
  } catch (error) {
    //console.error('Error al inicializar Monday SDK:', error);
    return false;
  }
}
async function confirmarRegistro(chatId, numeroTelefono, conversation) {
  try {
    //console.log('🔄 Iniciando confirmarRegistro:', { chatId, numeroTelefono });

    // 1. Verificar configuración de Monday.com
    if (!process.env.MONDAY_API_TOKEN || !process.env.MONDAY_BOARD_ID) {
      //console.error('❌ Faltan credenciales de Monday.com:', {
      //  token: process.env.MONDAY_API_TOKEN ? '✓' : '✗',
     //   boardId: process.env.MONDAY_BOARD_ID ? '✓' : '✗'
    //  });
      throw new Error('Configuración de Monday.com incompleta');
    }

    // 2. Verificar registro pendiente
    if (!pendingRegistrations.has(chatId)) {
      const message = 'No hay un registro pendiente para confirmar.';
      if (conversation) {
        conversation.push({ role: 'assistant', content: message });
        await guardarConversacion(numeroTelefono, { role: 'assistant', content: message });
      }
      await sendWhapiRequest('messages/text', { to: chatId, body: message });
      return null;
    }

    const pendingData = pendingRegistrations.get(chatId);
    //console.log('📄 Datos pendientes:', pendingData);

    // 3. Validar campos requeridos
    const camposFaltantes = [];
    if (!pendingData.cuadrante) camposFaltantes.push('Cuadrante');
    if (!pendingData.plaza) camposFaltantes.push('Plaza');
    if (!pendingData.observaciones) camposFaltantes.push('Observaciones');
    if (!pendingData.images || pendingData.images.length === 0) camposFaltantes.push('Imágenes');

    if (camposFaltantes.length > 0) {
      const validationMessage = `Faltan datos obligatorios:\n${camposFaltantes.map(campo => `- ${campo}`).join('\n')}`;
      if (conversation) {
        conversation.push({ role: 'assistant', content: validationMessage });
        await guardarConversacion(numeroTelefono, { role: 'assistant', content: validationMessage });
      }
      await sendWhapiRequest('messages/text', { to: chatId, body: validationMessage });
      return null;
    }

    try {
      // 4. Verificar conexión con Monday.com
      await verifyMondayBoard();
      //console.log('✅ Conexión con Monday.com verificada');

      // 5. Preparar registro completo
      const registroCompleto = {
        ...pendingData,
        numeroTelefono,
        createdAt: new Date(),
        status: 'Completado'
      };

      // 6. Guardar en MongoDB
      //console.log('💾 Guardando en MongoDB...');
      const jardinGuardado = await registrarJardinDesdeChat(chatId, registroCompleto);
      //console.log('✅ Guardado en MongoDB exitoso:', jardinGuardado);

      // 7. Crear en Monday.com
      //console.log('🔄 Creando registro en Monday.com...');
      const mondayData = {
        cuadrante: registroCompleto.cuadrante,
        plaza: registroCompleto.plaza,
        observaciones: registroCompleto.observaciones,
        numeroTelefono: registroCompleto.numeroTelefono,
        fecha: registroCompleto.createdAt.toISOString().split('T')[0]
      };

      const mondayResponse = await createMondayItem(mondayData);
      //console.log('✅ Registro creado en Monday.com:', mondayResponse);

      // 8. Subir imágenes a Monday.com
      if (registroCompleto.images && registroCompleto.images.length > 0) {
        //console.log(`📸 Subiendo ${registroCompleto.images.length} imágenes...`);
        const itemId = mondayResponse.data.create_item.id;

        for (const [index, image] of registroCompleto.images.entries()) {
          try {
            //console.log(`📤 Subiendo imagen ${index + 1}/${registroCompleto.images.length}`);
            
            const fileName = `imagen_${Date.now()}_${index + 1}.jpg`;
            const uploadResult = await uploadImageToMonday(
              image.data,
              fileName,
              image.contentType || 'image/jpeg',
              itemId
            );
      
            if (uploadResult.success) {
              //console.log(`✅ Imagen ${index + 1} subida exitosamente:`, uploadResult.data);
            } else {
              //console.error(`❌ Error al subir imagen ${index + 1}:`, uploadResult.error);
            }
          } catch (imageError) {
            //console.error(`❌ Error al procesar imagen ${index + 1}:`, imageError);
          }
        }
      }

      // 9. Preparar mensaje de confirmación
      const confirmationMessage = 
        '✅ ¡Registro guardado exitosamente!\n\n' +
        'Detalles:\n' +
        `📍 Cuadrante: ${registroCompleto.cuadrante}\n` +
        `🌳 Plaza: ${registroCompleto.plaza}\n` +
        `📝 Observaciones: ${registroCompleto.observaciones}\n` +
        `📸 Imágenes: ${registroCompleto.images.length}\n\n` +
        '📊 Guardado en:\n' +
        '- Base de datos\n' +
        '- Monday - Areas Verdes';

      // 10. Actualizar conversación antes de enviar mensajes
      if (conversation) {
        conversation.push({ role: 'assistant', content: confirmationMessage });
        await guardarConversacion(numeroTelefono, { role: 'assistant', content: confirmationMessage });
      }

      // 11. Enviar mensaje de confirmación
      await sendWhapiRequest('messages/text', { to: chatId, body: confirmationMessage });

      // 12. Enviar imágenes
     /* for (const image of registroCompleto.images) {
        await sendImage(
          chatId,
          Buffer.from(image.data).toString('base64'),
          image.contentType || 'image/jpeg',
          100,
          100,
          `${registroCompleto.plaza} - Cuadrante ${registroCompleto.cuadrante}`
        );
      }
*/
      // 13. Limpiar registro pendiente
      pendingRegistrations.delete(chatId);

      // 14. Retornar null para indicar que la respuesta ya fue manejada
      return null;

    } catch (error) {
      //console.error('❌ Error en el proceso:', error);
      const errorMessage = 
        '⚠️ Error al procesar el registro:\n' +
        '1. Verifica tu conexión\n' +
        '2. Revisa los datos\n' +
        '3. Intenta nuevamente\n\n' +
        'Si el problema persiste, contacta soporte.';

      if (conversation) {
        conversation.push({ role: 'assistant', content: errorMessage });
        await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });
      }
      
      await sendWhapiRequest('messages/text', { to: chatId, body: errorMessage });
      return null;
    }

  } catch (error) {
    //console.error('❌ Error crítico:', error);
    const criticalMessage = '⚠️ Error crítico. Contacta al soporte técnico.';
    
    if (conversation) {
      conversation.push({ role: 'assistant', content: criticalMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: criticalMessage });
    }
    
    await sendWhapiRequest('messages/text', { to: chatId, body: criticalMessage });
    return null;
  }
}

async function verifyMondayBoard() {
  try {
    // Verificar que el SDK esté inicializado
    if (!initializeMondaySdk()) {
      throw new Error('No se pudo inicializar Monday SDK');
    }

    // Verificar que existe el ID del tablero
    if (!process.env.MONDAY_BOARD_ID) {
      throw new Error('No se encontró MONDAY_BOARD_ID en las variables de entorno');
    }

    const query = `query {
      boards(ids: ${process.env.MONDAY_BOARD_ID}) {
        columns {
          title
          type
        }
      }
    }`;
    
    //console.log('Verificando tablero de Monday.com...');
    const response = await mondaySdk.api(query);
    
    if (response.errors) {
      throw new Error(`Error en la respuesta de Monday.com: ${JSON.stringify(response.errors)}`);
    }

    //console.log('Estructura del tablero Monday.com:', JSON.stringify(response.data, null, 2));
    return response;
  } catch (error) {
    //console.error('Error detallado al verificar tablero Monday.com:', {
    //  message: error.message,
    //  stack: error.stack,
    //  timestamp: new Date().toISOString()
   // });
    throw error;
  }
}

verifyMondayBoard();
async function checkMondayConfiguration() {
  try {
    //console.log('Verificando configuración de Monday.com...');
    
    // Verificar variables de entorno
    const configStatus = {
      MONDAY_API_TOKEN: process.env.MONDAY_API_TOKEN ? '✅ Presente' : '❌ Falta',
      MONDAY_BOARD_ID: process.env.MONDAY_BOARD_ID ? '✅ Presente' : '❌ Falta'
    };
    
    //console.log('Estado de configuración:', configStatus);

    // Intentar inicializar SDK
    const sdkInitialized = initializeMondaySdk();
    if (!sdkInitialized) {
      throw new Error('No se pudo inicializar Monday SDK');
    }

    // Verificar conexión y estructura del tablero
    const boardVerification = await verifyMondayBoard();
    
    if (boardVerification.data?.boards?.[0]) {
      //console.log('✅ Conexión con Monday.com verificada exitosamente');
      return true;
    } else {
      throw new Error('No se pudo verificar la estructura del tablero');
    }
  } catch (error) {
    //console.error('❌ Error en la verificación de Monday.com:', error.message);
    return false;
  }
}
async function handleMessage(req, res) {
  const messages = req.body.messages;

  for (const message of messages) {
    const chatId = message.chat_id;
    const numeroTelefono = message.from;

    if (!userMutexes.has(numeroTelefono)) {
      userMutexes.set(numeroTelefono, new Mutex());
    }

    const mutex = userMutexes.get(numeroTelefono);
    await mutex.runExclusive(async () => {
      if (message.type === 'text' && message.text.body.trim().toLowerCase() === 'confirmar registro') {
        await confirmarRegistro(chatId, numeroTelefono);
      } else {
        const responseMessage = 'Por favor, envía "confirmar registro" para guardar el registro pendiente.';
        await sendWhapiRequest('messages/text',{ to: chatId, body: responseMessage });
      }
    });
  }

  res.send('OK');
}
async function consultarRegistros(functionArgs, conversation, numeroTelefono) {
  try {
    //console.log('Procesando consulta con argumentos:', functionArgs);
    let mongoQuery = {};
    let registros;
    let startDate, endDate;

    // Verificar permisos del usuario
    if (!administratorNumbers.includes(numeroTelefono)) {
      const noPermissionsMessage = '🚫 No tienes permisos para consultar registros.';
      conversation.push({ role: 'assistant', content: noPermissionsMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: noPermissionsMessage });
      return { text: noPermissionsMessage, media: [] };
    }

    // Determinar el tipo de consulta y construir la query
    if (functionArgs.tipo) {
      switch (functionArgs.tipo) {
        case 'fecha':
          const { fecha, tipo } = functionArgs.criterios;
          
          if (tipo === 'dia') {
            startDate = new Date(fecha);
            startDate.setUTCHours(0, 0, 0, 0);
            
            endDate = new Date(fecha);
            endDate.setUTCHours(23, 59, 59, 999);
          } else if (tipo === 'mes') {
            const [year, month] = fecha.split('-');
            startDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));
            endDate = new Date(Date.UTC(parseInt(year), parseInt(month), 0, 23, 59, 59, 999));
          }

          mongoQuery = {
            createdAt: {
              $gte: startDate,
              $lte: endDate
            }
          };
          break;

        case 'especifica':
          const { campo, valor, exacto } = functionArgs.criterios;
          
          // Mejorar búsqueda para cuadrantes
          if (campo === 'cuadrante') {
            const numeroCuadrante = valor.replace(/[^0-9]/g, '');
            mongoQuery = {
              $or: [
                { cuadrante: numeroCuadrante },
                { cuadrante: `Cuadrante ${numeroCuadrante}` },
                { cuadrante: `CUADRANTE ${numeroCuadrante}` },
                { cuadrante: `cuadrante ${numeroCuadrante}` }
              ]
            };
          }
          // Mejorar búsqueda para plazas
          else if (campo === 'plaza') {
            const numeroPlaza = valor.replace(/[^0-9]/g, '');
            mongoQuery = {
              $or: [
                { plaza: new RegExp(`${numeroPlaza}`, 'i') },
                { plaza: new RegExp(`Plaza.*${numeroPlaza}`, 'i') },
                { plaza: new RegExp(`Plazoleta.*${numeroPlaza}`, 'i') }
              ]
            };
          }
          // Para otros campos
          else if (exacto) {
            mongoQuery[campo] = valor;
          } else {
            mongoQuery[campo] = { 
              $regex: valor,
              $options: 'i'
            };
          }
          break;

        case 'texto':
          const { palabrasClave, operador } = functionArgs.criterios;
          
          // Convertir cada palabra clave en un patrón de regex manejando frases completas
          const patterns = palabrasClave.map(palabra => 
            new RegExp(palabra.split(' ').join('.*'), 'i')
          );
          
          if (operador === 'OR') {
            mongoQuery.observaciones = { 
              $regex: patterns.map(p => p.source).join('|'),
              $options: 'i'
            };
          } else { // AND
            mongoQuery.observaciones = { 
              $regex: patterns.map(p => `(?=.*${p.source})`).join(''),
              $options: 'i'
            };
          }
          break;

        case 'listado':
          if (functionArgs.criterio === 'cuadrante') {
            registros = await Jardin.aggregate([
              {
                $group: {
                  _id: '$cuadrante',
                  count: { $sum: 1 },
                  plazas: { $addToSet: '$plaza' }
                }
              },
              { $sort: { _id: 1 } }
            ]);
            
            let responseMessage = '📊 Resumen de Cuadrantes:\n\n';
            registros.forEach(reg => {
              responseMessage += `📍 Cuadrante ${reg._id}:\n`;
              responseMessage += `   • ${reg.count} registros\n`;
              responseMessage += `   • ${reg.plazas.length} espacios diferentes\n\n`;
            });
            
            // Guardar en el contexto
            const resumenContext = {
              tipo: 'resumen',
              datos: registros,
              fecha: new Date().toISOString()
            };
            
            conversation.push({ 
              role: 'system', 
              content: `Resultados de búsqueda almacenados: ${JSON.stringify(resumenContext, null, 2)}`
            });
            conversation.push({ role: 'assistant', content: responseMessage });
            await guardarConversacion(numeroTelefono, { 
              role: 'assistant', 
              content: responseMessage,
              metadata: resumenContext
            });
            
            return { text: responseMessage, media: [], metadata: resumenContext };
          }
          break;
      }
    } else {
      const { criterio, valor } = functionArgs;
      
      if (criterio === 'cuadrante') {
        const numeroCuadrante = valor.replace(/[^0-9]/g, '');
        mongoQuery = {
          $or: [
            { cuadrante: numeroCuadrante },
            { cuadrante: `Cuadrante ${numeroCuadrante}` },
            { cuadrante: `CUADRANTE ${numeroCuadrante}` },
            { cuadrante: `cuadrante ${numeroCuadrante}` }
          ]
        };
      } else if (criterio === 'plaza') {
        const numeroPlaza = valor.replace(/[^0-9]/g, '');
        mongoQuery = {
          $or: [
            { plaza: new RegExp(`${numeroPlaza}`, 'i') },
            { plaza: new RegExp(`Plaza.*${numeroPlaza}`, 'i') },
            { plaza: new RegExp(`Plazoleta.*${numeroPlaza}`, 'i') }
          ]
        };
      } else if (criterio === 'observaciones' || criterio === 'tarea') {
        mongoQuery = { observaciones: { $regex: valor, $options: 'i' } };
      }
    }

    if (!registros) {
      registros = await Jardin.find(mongoQuery)
        .sort({ createdAt: -1 })
        .limit(50); // Limitar resultados para evitar sobrecarga
    }

    //console.log(`📊 Se encontraron ${registros.length} registros`);

    if (registros.length === 0) {
      const noRecordsMessage = functionArgs.tipo === 'fecha' ? 
        `No se encontraron registros para la fecha especificada.` :
        'No se encontraron registros que coincidan con los criterios especificados.';
      
      conversation.push({ role: 'assistant', content: noRecordsMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: noRecordsMessage });
      return { text: noRecordsMessage, media: [] };
    }

    // Procesar y enriquecer resultados con información adicional
    const registrosProcesados = await Promise.all(registros.map(async (registro) => {
      try {
        const cuadrante = await Cuadrante.findOne({
          cuadrante: { $regex: new RegExp(`^(Cuadrante\\s*)?${registro.cuadrante}$`, 'i') }
        });

        let metrosCuadrados = 0;
        let direccionPlaza = '';

        if (cuadrante) {
          const numeroPlaza = registro.plaza.replace(/[^0-9]/g, '');
          const plaza = cuadrante.plazas.find(p => p.numero.toString() === numeroPlaza);
          if (plaza) {
            metrosCuadrados = plaza.metrosCuadrados;
            direccionPlaza = plaza.direccion;
          }
        }

        return {
          ...registro.toObject(),
          metrosCuadrados,
          direccion: direccionPlaza,
          images: registro.images || []
        };
      } catch (error) {
        //console.error('Error procesando registro:', error);
        return registro.toObject();
      }
    }));

    const resultadosContext = {
      query: mongoQuery,
      totalRegistros: registros.length,
      fechaConsulta: new Date().toISOString(),
      registros: registrosProcesados.map(r => ({
        id: r._id.toString(),
        cuadrante: r.cuadrante,
        plaza: r.plaza,
        observaciones: r.observaciones,
        fecha: r.createdAt,
        metrosCuadrados: r.metrosCuadrados,
        direccion: r.direccion,
        tieneImagenes: r.images && r.images.length > 0
      }))
    };

    // Construir respuesta detallada
    let responseMessage = `📊 Resultados de la búsqueda:\n`;
    responseMessage += `• Total de registros: ${registros.length}\n`;
    
    if (functionArgs.tipo === 'fecha' && startDate) {
      responseMessage += `• Fecha de búsqueda: ${startDate.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}\n\n`;
    } else {
      responseMessage += `• Cuadrantes diferentes: ${new Set(registros.map(r => r.cuadrante)).size}\n`;
      responseMessage += `• Espacios únicos: ${new Set(registros.map(r => r.plaza)).size}\n\n`;
    }

    // Organizar y mostrar registros detallados
    registrosProcesados.forEach((registro, index) => {
      responseMessage += `${index + 1}. Cuadrante ${registro.cuadrante} - ${registro.plaza}\n`;
      if (registro.metrosCuadrados) responseMessage += `   📏 ${registro.metrosCuadrados}m²\n`;
      if (registro.direccion) responseMessage += `   📍 ${registro.direccion}\n`;
      responseMessage += `   📅 ${new Date(registro.createdAt).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}\n`;
      responseMessage += `   📝 ${registro.observaciones}\n\n`;
    });

    // Recopilar imágenes para enviar
    let media = [];
    const maxTotalImages = 10; // Limitar el número total de imágenes a enviar

    for (const registro of registrosProcesados) {
      if (media.length >= maxTotalImages) break;

      if (registro.images && registro.images.length > 0) {
        // Limitar el número de imágenes por registro si es necesario
        const imagesToSend = registro.images.slice(0, maxTotalImages - media.length);

        for (const image of imagesToSend) {
          media.push({
            data: image.data,
            mimeType: image.contentType || 'image/jpeg',
          });

          if (media.length >= maxTotalImages) break;
        }
      }
    }

    // Guardar en la conversación
    conversation.push({ 
      role: 'system', 
      content: `Resultados de búsqueda almacenados: ${JSON.stringify(resultadosContext, null, 2)}`
    });
    conversation.push({ role: 'assistant', content: responseMessage });
    
    await guardarConversacion(numeroTelefono, { 
      role: 'assistant', 
      content: responseMessage,
      metadata: resultadosContext
    });

    return {
      text: responseMessage,
      media: media,
      metadata: {
        ...resultadosContext,
        ...(startDate && endDate && {
          fechasBuscadas: {
            inicio: startDate,
            fin: endDate
          }
        })
      }
    };

  } catch (error) {
    //console.error('❌ Error en consultarRegistros:', error);
    const errorMessage = `Error al procesar la consulta: ${error.message}\n` +
                        'Por favor, intente reformular su consulta o contacte al soporte técnico.';
    
    conversation.push({ role: 'assistant', content: errorMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });
    
    return {
      text: errorMessage,
      media: [],
      metadata: {
        error: true,
        errorType: error.name,
        errorMessage: error.message,
        fechaError: new Date().toISOString()
      }
    };
  }
}

  


async function uploadImageToMonday(imageData, fileName, mimeType, itemId) {
  try {
    //console.log('📤 Iniciando subida de imagen a Monday.com:', {
    //  fileName,
    //  mimeType,
   //   itemId,
  //    imageSize: imageData.length
  //  });

    if (!imageData || !itemId) {
      throw new Error('Se requieren datos de imagen y ID del item');
    }

    // Crear archivo temporal
    const tempFilePath = path.join(__dirname, `temp_${Date.now()}_${fileName || 'image.jpg'}`);
    fs.writeFileSync(tempFilePath, imageData);

    // Preparar la mutación
    const query = `mutation($file: File!) {
      add_file_to_column(
        item_id: ${itemId},
        column_id: "cargar_archivo__1",
        file: $file
      ) {
        id
        url
      }
    }`;

    // Crear FormData
    const formData = new FormData();
    formData.append('query', query);
    formData.append('variables[file]', fs.createReadStream(tempFilePath), {
      filename: fileName || 'image.jpg',
      contentType: mimeType || 'image/jpeg'
    });

    // Realizar la solicitud
    const response = await axios.post('https://api.monday.com/v2/file', formData, {
      headers: {
        'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
        ...formData.getHeaders()
      }
    });

    // Limpiar archivo temporal
    fs.unlinkSync(tempFilePath);

    //console.log('📥 Respuesta de Monday.com:', response.data);

    if (response.data.errors) {
      throw new Error(JSON.stringify(response.data.errors));
    }

    return {
      success: true,
      data: response.data.data
    };

  } catch (error) {
    //console.error('❌ Error en uploadImageToMonday:', error);
    return {
      success: false,
      error: error.message,
      details: {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      }
    };
  }
}



function detectMimeType(imageData) {
  // Si es un buffer, intentar detectar por los primeros bytes
  if (Buffer.isBuffer(imageData)) {
    if (imageData[0] === 0xFF && imageData[1] === 0xD8) {
      return 'image/jpeg';
    }
    if (imageData[0] === 0x89 && imageData[1] === 0x50) {
      return 'image/png';
    }
    if (imageData[0] === 0x47 && imageData[1] === 0x49) {
      return 'image/gif';
    }
  }
  
  // Por defecto, asumir JPEG
  return 'image/jpeg';
}

function validateImageSize(imageBuffer, maxSizeMB = 5) {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (imageBuffer.length > maxSizeBytes) {
    throw new Error(`La imagen excede el tamaño máximo permitido de ${maxSizeMB}MB`);
  }
  return true;
}
async function getLLMResponse(chatId, userMessage, numeroTelefono, userType) {
  try {
    if (!userMessage) {
      return { text: 'Lo siento, no he recibido ningún texto para procesar.', media: [] };
    }

    if (!conversations.has(chatId)) {
      conversations.set(chatId, []);
    }
    const conversation = conversations.get(chatId);

    conversation.push({ role: 'user', content: userMessage });
    await guardarConversacion(numeroTelefono, { role: 'user', content: userMessage });

    // Para administradores, combinar ambas instrucciones
    const BASE_INSTRUCTIONS = userType === 'administrator' 
      ? `${BASE_INSTRUCTIONS_OPERATOR}\n\n${BASE_INSTRUCTIONS_ADMINISTRATOR}`
      : BASE_INSTRUCTIONS_OPERATOR;

    // Construir el array de mensajes base
    const messages = [
      { role: 'system', content: BASE_INSTRUCTIONS },
      ...conversation,
    ];

    // Añadir información de registro pendiente si existe
    if (pendingRegistrations.has(chatId)) {
      const pendingData = pendingRegistrations.get(chatId) || {
        cuadrante: '',
        plaza: '',
        observaciones: '',
        images: [],
      };

      let sanitizedData ;
      const { images, ...restOfPendingData } = pendingData; 
      if (pendingData.cuadrante || pendingData.plaza || pendingData.observaciones) {
        // Registro pendiente de Jardín
        sanitizedData = {
          tipoRegistro: 'jardin',
          ...restOfPendingData,
          images: pendingData.images.map((img, index) => ({
            index: index + 1,
            contentType: img.contentType,
          })),
        };
      } else if (pendingData.nombre || pendingData.lugarDeReferencia || pendingData.categoria) {
        // Registro pendiente de Programa
        sanitizedData = {
          tipoRegistro: 'programa',
          ...restOfPendingData,
          images: images.map((img, index) => ({
            index: index + 1,
            contentType: img.contentType,
          })),
        };
      } else {
        sanitizedData = restOfPendingData;
      }
      messages.push({
        role: 'system',
        content: `Datos del registro pendiente:\n${JSON.stringify(sanitizedData, null, 2)}`,
      });
    }

    // Para administradores, añadir contexto de conversación y resultados previos
    if (userType === 'administrator') {
      // Obtener resultados previos de la conversación
      const previousResults = conversation
        .filter(msg => msg.role === 'system' && msg.content.includes('Resultados de búsqueda'))
        .pop();

      // Añadir mensaje de contexto
      messages.push({
        role: 'system',
        content: `Contexto actual de la conversación:
${previousResults 
  ? `Hay resultados de una búsqueda previa disponibles:\n${previousResults.content}`
  : 'No hay resultados previos disponibles.'}`
      });

      // Añadir instrucciones específicas para el manejo del contexto
      messages.push({
        role: 'system',
        content: `Instrucciones para el manejo del contexto:
1. Analiza si la pregunta del usuario se refiere a los resultados mostrados anteriormente
2. Si la pregunta es sobre datos ya mostrados, usa la información del contexto
3. Si se necesita información nueva o diferente, realiza una nueva consulta
4. Explica brevemente tu decisión de usar datos existentes o hacer una nueva consulta`
      });
    }

    let response;
    if (userType === 'operator') {
      response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        functions: functions.filter((func) => 
          [
            'registrarJardin', 
            'modificarRegistro', 
            'confirmarRegistro',
            'registrarPrograma',
            'modificarRegistroPrograma',
            'confirmarRegistroPrograma'
          ].includes(func.name)
        ),
        function_call: 'auto',
        temperature: 0.7,
      });
    } else if (userType === 'administrator') {
      response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        functions: functions,
        function_call: 'auto',
        temperature: 0.7,
      });
    } else {
      response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        temperature: 0.7,
      });
    }

    const assistantMessage = response.choices[0].message;
    //console.log('Assistant message:', assistantMessage);

    if (assistantMessage.function_call) {
      const functionName = assistantMessage.function_call.name;
      const functionArgs = assistantMessage.function_call.arguments
        ? JSON.parse(assistantMessage.function_call.arguments)
        : {};

      // Verificar permisos para operadores
      if (userType === 'operator' && 
        !['registrarJardin', 'modificarRegistro', 'confirmarRegistro',
          'registrarPrograma', 'modificarRegistroPrograma', 'confirmarRegistroPrograma'].includes(functionName)) {
        const notAuthorizedMessage = 'Lo siento, no tienes permiso para realizar esta acción.';
        conversation.push({ role: 'assistant', content: notAuthorizedMessage });
        await guardarConversacion(numeroTelefono, { role: 'assistant', content: notAuthorizedMessage });
        return { text: notAuthorizedMessage, media: [] };
      }

      //console.log(`🔄 Iniciando handleFunctionCall:`, { functionName, chatId, numeroTelefono });
      
      const functionResponse = await handleFunctionCall(chatId, functionName, functionArgs, conversation, numeroTelefono);
      if (functionResponse === null) {
        return null;
      }

      // Manejar respuestas con medios
      if (functionResponse.media && Array.isArray(functionResponse.media) && functionResponse.media.length > 0) {
        await sendWhapiRequest('messages/text', { to: chatId, body: functionResponse.text });

        for (const mediaItem of functionResponse.media) {
          if (mediaItem.data) {
            const base64Image = Buffer.from(mediaItem.data).toString('base64');
            await sendImage(
              numeroTelefono,
              base64Image,
              mediaItem.mimeType || 'image/jpeg',
              100,
              100,
              'Imagen del registro'
            );
          }
        }
        return null;
      } else {
        return { text: functionResponse.text, media: [] };
      }
    }

    if (assistantMessage.content) {
      conversation.push(assistantMessage);
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: assistantMessage.content });
      return { text: assistantMessage.content, media: [] };
    } else {
      const defaultMessage = 'Lo siento, no pude procesar tu solicitud.';
      conversation.push({ role: 'assistant', content: defaultMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: defaultMessage });
      return { text: defaultMessage, media: [] };
    }
  } catch (error) {
    //console.error('Error en getLLMResponse:', error);
    return { text: 'Lo siento, ha ocurrido un error al procesar tu mensaje.', media: [] };
  }
}



async function handleNewMessages(req, res) {
  try {
    const messages = req?.body?.messages;
    for (let message of messages) {
      if (message.from_me) continue;

      // Ignorar mensajes de tipo 'unknown' o con origen 'system'
      if (message.type === 'unknown' || message.source === 'system') {
        //console.log('Ignoring system message:', JSON.stringify(message, null, 2));
        continue;
      }

      const chatId = message.chat_id;
      const numeroTelefono = message.from;

      if (!operatorNumbers.includes(numeroTelefono) && !administratorNumbers.includes(numeroTelefono)) {
        const responseText = 'Lo siento, soy un asistente, pero no puedo responder a su mensaje.';
        await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
        continue;
      }

      // Obtener o crear el mutex para el usuario
      if (!userMutexes.has(numeroTelefono)) {
        userMutexes.set(numeroTelefono, new Mutex());
      }
      const mutex = userMutexes.get(numeroTelefono);

      // Procesar el mensaje dentro del mutex
      await mutex.runExclusive(async () => {
        await processMessage(message, chatId, numeroTelefono);
      });
    }

    res.send('Ok');
  } catch (e) {
    //console.error('Error en handleNewMessages:', e);
    res.status(500).send(e.message);
  }
}

async function processMessage(message, chatId, numeroTelefono) {
  let userType;

  if (operatorNumbers.includes(numeroTelefono)) {
    userType = 'operator';
  } else if (administratorNumbers.includes(numeroTelefono)) {
    userType = 'administrator';
  } else {
    const responseText = 'Lo siento, soy un asistente, pero no puedo responder a su mensaje.';
    await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
    return;
  }

  //console.log('Received message:', JSON.stringify(message, null, 2));

  try {
    if (message.type === 'text') {
      const messageText = message.text?.body?.trim();
      try {
        const responseObj = await getLLMResponse(chatId, messageText, numeroTelefono, userType);
        
        // Si responseObj es null, significa que la respuesta ya fue manejada
        if (responseObj === null) {
          return;
        }

        // Solo enviar mensajes si hay una respuesta válida
        if (responseObj?.text) {
          await sendWhapiRequest('messages/text', { to: chatId, body: responseObj.text });

          if (responseObj.media && Array.isArray(responseObj.media) && responseObj.media.length > 0) {
            const promises = responseObj.media.map(async (mediaItem) => {
              if (mediaItem?.data) {
                return sendImage(
                  chatId,
                  Buffer.from(mediaItem.data).toString('base64'),
                  mediaItem.mimeType || 'image/jpeg',
                  100,
                  100,
                  'Imagen del registro'
                );
              }
            }).filter(Boolean);
            
            if (promises.length > 0) {
              await Promise.all(promises);
            }
          }
        }
      } catch (error) {
        // Si el error indica que la respuesta ya fue manejada, simplemente retornar
        if (error.message === 'Response already handled') {
          return;
        }
        throw error;
      }
    } else if (message.type === 'image') {
      if (userType === 'operator'|| userType === 'administrator') {
        try {
          const imageInfo = message.image;
          const imageUrl = imageInfo.link;

          if (!imageUrl) {
            const responseText = 'No se pudo obtener el enlace de la imagen.';
            await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
            return;
          }

          // Descargar la imagen como datos binarios
          const imageData = await downloadImage(imageUrl);
          const imageContentType = imageInfo.mime_type;

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

          // Almacenar la imagen
          pendingData.images.push({
            data: imageData,
            contentType: imageContentType,
          });
          pendingRegistrations.set(chatId, pendingData);

          const responseText = 'Imagen recibida y añadida al registro pendiente.';
          await sendWhapiRequest('messages/text', { to: chatId, body: responseText });

          const messageText = 'He recibido una imagen para el registro.';
          const responseObj = await getLLMResponse(chatId, messageText, numeroTelefono, 'operator');

          if (responseObj === null) {
            return;
          }

          if (responseObj?.text) {
            await sendWhapiRequest('messages/text', { to: chatId, body: responseObj.text });
          }
        } catch (error) {
          //console.error('Error al procesar imagen:', error);
          if (error.message !== 'Response already handled') {
            await sendWhapiRequest('messages/text', {
              to: chatId,
              body: 'Lo siento, ha ocurrido un error al procesar la imagen.'
            });
          }
        }
      } else {
        await sendWhapiRequest('messages/text', {
          to: chatId,
          body: 'Lo siento, no puedo procesar imágenes en este momento.'
        });
      }
    } else if (message.type === 'audio' || message.type === 'voice') {
      try {
        const audioInfo = message.audio || message.voice;
        const audioUrl = audioInfo.link;

        if (!audioUrl) {
          await sendWhapiRequest('messages/text', {
            to: chatId,
            body: 'No se pudo obtener el enlace del audio.'
          });
          return;
        }

        const audioData = await downloadAudio(audioUrl);
        const mimeType = audioInfo.mime_type.split(';')[0];
        const audioExtension = mimeType.split('/')[1];
        const audioFileName = `audio_${Date.now()}.${audioExtension}`;
        const audioPath = path.join(__dirname, 'audios', audioFileName);

        fs.mkdirSync(path.dirname(audioPath), { recursive: true });
        fs.writeFileSync(audioPath, audioData);

        const transcription = await transcribeAudio(audioPath);
        fs.unlinkSync(audioPath);

        if (!transcription) {
          await sendWhapiRequest('messages/text', {
            to: chatId,
            body: 'Lo siento, no pude transcribir el audio.'
          });
          return;
        }

        const responseObj = await getLLMResponse(chatId, transcription, numeroTelefono, userType);
        
        if (responseObj === null) {
          return;
        }

        if (responseObj?.text) {
          await sendWhapiRequest('messages/text', { to: chatId, body: responseObj.text });
        }
      } catch (error) {
        //console.error('Error al procesar audio:', error);
        if (error.message !== 'Response already handled') {
          await sendWhapiRequest('messages/text', {
            to: chatId,
            body: 'Lo siento, ha ocurrido un error al procesar el audio.'
          });
        }
      }
    } else {
      await sendWhapiRequest('messages/text', {
        to: chatId,
        body: 'Lo siento, no puedo procesar este tipo de mensaje.'
      });
    }
  } catch (error) {
    //console.error('Error en processMessage:', error);
    // No enviar mensaje de error si la respuesta ya fue manejada
    if (error.message !== 'Response already handled') {
      await sendWhapiRequest('messages/text', {
        to: chatId,
        body: 'Lo siento, ha ocurrido un error al procesar tu mensaje.'
      });
    }
  }
}


async function handleImageMessage(message, chatId, numeroTelefono, userType) {
  if (userType !== 'operator') {
    const responseText = 'Lo siento, no puedo procesar ese tipo de mensaje.';
    await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
    return;
  }

  try {
    const imageInfo = message.image;
    const imageUrl = imageInfo.link;

    if (!imageUrl) {
      const responseText = 'No se pudo obtener el enlace de la imagen.';
      await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
      return;
    }

    // Descargar la imagen como datos binarios
    const imageData = await downloadImage(imageUrl);
    const imageContentType = imageInfo.mime_type; // Obtener el tipo MIME de la imagen

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

    // Almacenar la imagen como objeto con datos binarios y tipo de contenido
    pendingData.images.push({
      data: imageData,
      contentType: imageContentType,
    });
    pendingRegistrations.set(chatId, pendingData);

    const responseText = 'Imagen recibida y añadida al registro pendiente.';
    await sendWhapiRequest('messages/text', { to: chatId, body: responseText });

    const messageText = 'He recibido una imagen para el registro.';
    const responseObj = await getLLMResponse(chatId, messageText, numeroTelefono, 'operator');

    if (responseObj && responseObj.text) {
      await sendWhapiRequest('messages/text', { to: chatId, body: responseObj.text });

      // Si hay medios, enviarlos
      if (responseObj.media && responseObj.media.length > 0) {
        for (const mediaItem of responseObj.media) {
          if (mediaItem.data) {
            const base64Image = Buffer.from(mediaItem.data).toString('base64');
            await sendImage(
              numeroTelefono,
              base64Image,
              mediaItem.mimeType || 'image/jpeg',
              100,
              100,
              'Imagen del registro'
            );
          }
        }
      }
    }
    // Si hay medios en la respuesta, ya fueron manejados en getLLMResponse
  } catch (error) {
    //console.error('Error al procesar el mensaje de imagen:', error);
    const responseText = 'Lo siento, ha ocurrido un error al procesar la imagen.';
    await sendWhapiRequest('messages/text', { to: chatId, body: responseText });
  }
}

async function modifyPendingRegistration(chatId, functionArgs, conversation, numeroTelefono) {
  const pendingData = pendingRegistrations.get(chatId) || {
    cuadrante: '',
    plaza: '',
    observaciones: '',
    images: [],
  };
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
      `¿Deseas confirmar este registro?`;

    conversation.push({ role: 'assistant', content: modificationMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: modificationMessage });

    return { text: modificationMessage, media: [] };
  } else if (campo === 'images') {
    if (valor.toLowerCase() === 'eliminar todas') {
      pendingData.images = [];
      pendingRegistrations.set(chatId, pendingData);

      const modificationMessage = `Todas las imágenes han sido eliminadas del registro pendiente.\n\n` +
        `Datos actuales del registro:\n` +
        `- Cuadrante: ${pendingData.cuadrante}\n` +
        `- Plaza: ${pendingData.plaza}\n` +
        `- Observaciones: ${pendingData.observaciones}\n` +
        `- Imágenes adjuntadas: ${pendingData.images.length}\n\n` +
        `¿Deseas confirmar este registro?`;

      conversation.push({ role: 'assistant', content: modificationMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: modificationMessage });

      return { text: modificationMessage, media: [] };
    } else {
      const errorMessage = `Para añadir imágenes, envíalas directamente.`;
      conversation.push({ role: 'assistant', content: errorMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });

      return { text: errorMessage, media: [] };
    }
  } else {
    const errorMessage = `El campo "${campo}" no es válido.`;
    conversation.push({ role: 'assistant', content: errorMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });

    return { text: errorMessage, media: [] };
  }
}
async function registrarPrograma(chatId, functionArgs, conversation, numeroTelefono) {
  let pendingPrograma = pendingRegistrations.get(chatId) || {
    nombre: '',
    lugarDeReferencia: '',
    categoria: '',
    fecha: new Date(), // Añade esta línea si deseas establecer la fecha aquí
    images: [],
    createdAt: new Date()
  };

  // Actualizar datos pendientes con los argumentos proporcionados
  pendingPrograma = {
    ...pendingPrograma,
    ...functionArgs,
    lastUpdated: new Date(),
  };

  // Preservar imágenes existentes si no se proporcionan nuevas
  if (functionArgs.images) {
    delete functionArgs.images;
  }

  pendingRegistrations.set(chatId, pendingPrograma);

  // Preparar mensaje de confirmación
  const confirmationRequest =
    '📋 Información del programa registrada:\n\n' +
    `🎭 Nombre: ${pendingPrograma.nombre || '❌ Pendiente'}\n` +
    `📍 Lugar de Referencia: ${pendingPrograma.lugarDeReferencia || '❌ Pendiente'}\n` +
    `🗂️ Categoría: ${pendingPrograma.categoria || '❌ Pendiente'}\n` +
    `📸 Imágenes: ${pendingPrograma.images.length} adjuntadas\n\n` +
    (isProgramaRegistroCompleto(pendingPrograma)
      ? '✅ Todos los datos necesarios están completos. Puedes confirmar el registro.'
      : '⚠️ Aún faltan datos por completar. Por favor, proporciona la información faltante.');

  // Actualizar conversación
  conversation.push({ role: 'assistant', content: confirmationRequest });
  await guardarConversacion(numeroTelefono, { role: 'assistant', content: confirmationRequest });

  return { text: confirmationRequest, media: [] };
}

async function modifyPendingProgramaRegistration(chatId, functionArgs, conversation, numeroTelefono) {
  const pendingPrograma = pendingRegistrations.get(chatId) || {
    nombre: '',
    lugarDeReferencia: '',
    categoria: '',
    images: [],
  };
  const campo = functionArgs.campo.toLowerCase();
  const valor = functionArgs.valor;

  if (['nombre', 'lugarDeReferencia', 'categoria'].includes(campo)) {
    pendingPrograma[campo] = valor;
    pendingRegistrations.set(chatId, pendingPrograma);

    const modificationMessage = `El campo "${campo}" ha sido actualizado a: ${valor}.\n\n` +
      `Datos actuales del registro de programa:\n` +
      `🎭 Nombre: ${pendingPrograma.nombre}\n` +
      `📍 Lugar de Referencia: ${pendingPrograma.lugarDeReferencia}\n` +
      `🗂️ Categoría: ${pendingPrograma.categoria}\n` +
      `📸 Imágenes adjuntadas: ${pendingPrograma.images.length}\n\n` +
      `¿Deseas confirmar este registro?`;

    conversation.push({ role: 'assistant', content: modificationMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: modificationMessage });

    return { text: modificationMessage, media: [] };
  } else if (campo === 'images') {
    // Manejo de imágenes
    // ...
  } else {
    const errorMessage = `El campo "${campo}" no es válido para el registro de programa.`;
    conversation.push({ role: 'assistant', content: errorMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });

    return { text: errorMessage, media: [] };
  }
}
async function confirmarRegistroPrograma(chatId, numeroTelefono, conversation) {
  try {
    // Verificar registro pendiente de programa
    if (!pendingRegistrations.has(chatId)) {
      const message = 'No hay un registro de programa pendiente para confirmar.';
      conversation.push({ role: 'assistant', content: message });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: message });
      await sendWhapiRequest('messages/text', { to: chatId, body: message });
      return null;
    }

    const pendingData = pendingRegistrations.get(chatId);

    // Validar campos requeridos
    const camposFaltantes = [];
    if (!pendingData.nombre) camposFaltantes.push('Nombre');
    if (!pendingData.lugarDeReferencia) camposFaltantes.push('Lugar de Referencia');
    if (!pendingData.categoria) camposFaltantes.push('Categoría');
    if (!pendingData.images || pendingData.images.length === 0) camposFaltantes.push('Imágenes');

    if (camposFaltantes.length > 0) {
      const validationMessage = `Faltan datos obligatorios:\n${camposFaltantes.map(campo => `- ${campo}`).join('\n')}`;
      conversation.push({ role: 'assistant', content: validationMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: validationMessage });
      await sendWhapiRequest('messages/text', { to: chatId, body: validationMessage });
      return null;
    }

    // Guardar en MongoDB
    const { registrarProgramaDesdeChat } = require('./controllers/programaController');
    const programaGuardado = await registrarProgramaDesdeChat(chatId, {
      ...pendingData,
      numeroTelefono,
      createdAt: new Date(),
      fecha: new Date()
    });

    // Preparar mensaje de confirmación
    const confirmationMessage =
      '✅ ¡Registro de programa guardado exitosamente!\n\n' +
      'Detalles:\n' +
      `🎭 Nombre: ${pendingData.nombre}\n` +
      `📍 Lugar de Referencia: ${pendingData.lugarDeReferencia}\n` +
      `🗂️ Categoría: ${pendingData.categoria}\n` +
      `📸 Imágenes: ${pendingData.images.length}\n\n` +
      '📊 Guardado en la base de datos.';

    conversation.push({ role: 'assistant', content: confirmationMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: confirmationMessage });
    await sendWhapiRequest('messages/text', { to: chatId, body: confirmationMessage });

    // Limpiar registro pendiente
    pendingRegistrations.delete(chatId);

    return null;
  } catch (error) {
    //console.error('Error al confirmar registro de programa:', error);
    const errorMessage = '⚠️ Error al guardar el registro de programa. Por favor, inténtalo nuevamente.';
    conversation.push({ role: 'assistant', content: errorMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });
    await sendWhapiRequest('messages/text', { to: chatId, body: errorMessage });
    return null;
  }
}

function isProgramaRegistroCompleto(registro) {
  return (
    registro.nombre &&
    registro.lugarDeReferencia &&
    registro.categoria &&
    registro.images &&
    registro.images.length > 0
  );
}
async function consultarProgramas(functionArgs, conversation, numeroTelefono) {
  try {
   // ////console.log('Procesando consulta de programas con argumentos:', functionArgs);
    let mongoQuery = {};
    let programas;
    let startDate, endDate;

    // Verificar permisos del usuario
    if (!administratorNumbers.includes(numeroTelefono)) {
      const noPermissionsMessage = '🚫 No tienes permisos para consultar programas.';
      conversation.push({ role: 'assistant', content: noPermissionsMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: noPermissionsMessage });
      return { text: noPermissionsMessage, media: [] };
    }

    // Construir la consulta según el tipo
    if (functionArgs.tipo) {
      switch (functionArgs.tipo) {
        case 'fecha':
          const { fecha, tipo } = functionArgs.criterios;
          
          if (tipo === 'dia') {
            startDate = new Date(fecha);
            startDate.setUTCHours(0, 0, 0, 0);
            endDate = new Date(fecha);
            endDate.setUTCHours(23, 59, 59, 999);
          } else if (tipo === 'mes') {
            const [year, month] = fecha.split('-');
            startDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));
            endDate = new Date(Date.UTC(parseInt(year), parseInt(month), 0, 23, 59, 59, 999));
          }

          mongoQuery = {
            fecha: {
              $gte: startDate,
              $lte: endDate
            }
          };
          break;

        case 'especifica':
          const { campo, valor, exacto } = functionArgs.criterios;

          if (exacto) {
            mongoQuery[campo] = valor;
          } else {
            mongoQuery[campo] = { 
              $regex: valor,
              $options: 'i'
            };
          }
          break;

        case 'texto':
          const { palabrasClave, operador } = functionArgs.criterios;

          const patterns = palabrasClave.map(palabra => 
            new RegExp(palabra.split(' ').join('.*'), 'i')
          );

          if (operador === 'OR') {
            mongoQuery.$or = patterns.map(p => ({ nombre: { $regex: p } }));
          } else { // AND
            mongoQuery.$and = patterns.map(p => ({ nombre: { $regex: p } }));
          }
          break;

        case 'listado':
          if (functionArgs.criterio === 'categoria') {
            programas = await Programa.aggregate([
              {
                $group: {
                  _id: '$categoria',
                  count: { $sum: 1 },
                  programas: { $addToSet: '$nombre' }
                }
              },
              { $sort: { _id: 1 } }
            ]);
            
            let responseMessage = '📊 Resumen de Categorías:\n\n';
            programas.forEach(reg => {
              responseMessage += `📂 Categoría ${reg._id}:\n`;
              responseMessage += `   • ${reg.count} programas\n`;
              responseMessage += `   • Programas: ${reg.programas.join(', ')}\n\n`;
            });
            
            // Guardar en el contexto
            const resumenContext = {
              tipo: 'resumen',
              datos: programas,
              fecha: new Date().toISOString()
            };
            
            conversation.push({ 
              role: 'system', 
              content: `Resultados de búsqueda almacenados: ${JSON.stringify(resumenContext, null, 2)}`
            });
            conversation.push({ role: 'assistant', content: responseMessage });
            await guardarConversacion(numeroTelefono, { 
              role: 'assistant', 
              content: responseMessage,
              metadata: resumenContext
            });
            
            return { text: responseMessage, media: [], metadata: resumenContext };
          }
          break;

        default:
          throw new Error('Tipo de consulta no soportado');
      }
    }

    if (!programas) {
      programas = await Programa.find(mongoQuery)
        .sort({ fecha: -1 })
        .limit(50); // Limitar resultados para evitar sobrecarga
    }

  //  ////console.log(`📊 Se encontraron ${programas.length} programas`);

    if (programas.length === 0) {
      const noRecordsMessage = functionArgs.tipo === 'fecha' ? 
        `No se encontraron programas para la fecha especificada.` :
        'No se encontraron programas que coincidan con los criterios especificados.';
      
      conversation.push({ role: 'assistant', content: noRecordsMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: noRecordsMessage });
      return { text: noRecordsMessage, media: [] };
    }

    // Procesar y enriquecer resultados
    const programasProcesados = programas.map(programa => ({
      ...programa.toObject(),
      images: programa.images || []
    }));

    // Construir respuesta
    let responseMessage = `📊 Resultados de la búsqueda:\n`;
    responseMessage += `• Total de programas: ${programas.length}\n\n`;

    programasProcesados.forEach((programa, index) => {
      responseMessage += `${index + 1}. ${programa.nombre}\n`;
      responseMessage += `   📍 Lugar: ${programa.lugarDeReferencia}\n`;
      responseMessage += `   📂 Categoría: ${programa.categoria}\n`;
      responseMessage += `   📅 Fecha: ${new Date(programa.fecha).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}\n`;
      responseMessage += `   📸 Imágenes: ${programa.images.length}\n\n`;
    });

    // Guardar en la conversación
    conversation.push({ 
      role: 'assistant', 
      content: responseMessage
    });
    await guardarConversacion(numeroTelefono, { 
      role: 'assistant', 
      content: responseMessage,
      metadata: {
        query: mongoQuery,
        totalProgramas: programas.length,
        fechaConsulta: new Date().toISOString(),
        programas: programasProcesados
      }
    });

    return {
      text: responseMessage,
      media: [],
      metadata: {
        query: mongoQuery,
        totalProgramas: programas.length,
        fechaConsulta: new Date().toISOString(),
        programas: programasProcesados
      }
    };

  } catch (error) {
  //  ////console.error('❌ Error en consultarProgramas:', error);
    const errorMessage = `Error al procesar la consulta: ${error.message}\n` +
                        'Por favor, intente reformular su consulta o contacte al soporte técnico.';
    
    conversation.push({ role: 'assistant', content: errorMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });
    
    return {
      text: errorMessage,
      media: [],
      metadata: {
        error: true,
        errorType: error.name,
        errorMessage: error.message,
        fechaError: new Date().toISOString()
      }
    };
  }
}

async function handleFunctionCall(chatId, functionName, functionArgs, conversation, numeroTelefono) {
  try {
    ////console.log('Iniciando handleFunctionCall:', {
    //  functionName,
    //  chatId,
   //   numeroTelefono,
  //    argumentos: functionArgs
 //   });

    switch (functionName) {
      case 'registrarJardin':
        try {
          let registro = pendingRegistrations.get(chatId) || {
            cuadrante: '',
            plaza: '',
            observaciones: '',
            images: [],
            createdAt: new Date()
          };

          // Actualizar registro con nuevos datos
          registro = {
            ...registro,
            ...functionArgs,
            lastUpdated: new Date()
          };

          // Preservar imágenes existentes
          if (functionArgs.images) {
            delete functionArgs.images;
          }

          pendingRegistrations.set(chatId, registro);
        //  ////console.log('📝 Registro actualizado:', registro);

          // Preparar mensaje de confirmación
          const confirmationRequest = 
            '📋 Información registrada:\n\n' +
            `📍 Cuadrante: ${registro.cuadrante || '❌ Pendiente'}\n` +
            `🌳 Plaza: ${registro.plaza || '❌ Pendiente'}\n` +
            `📝 Observaciones: ${registro.observaciones || '❌ Pendiente'}\n` +
            `📸 Imágenes: ${registro.images.length} adjuntadas\n\n` +
            (isRegistroCompleto(registro) ?
              '✅ Todos los datos necesarios están completos. Puedes confirmar el registro.' :
              '⚠️ Aún faltan datos por completar. Por favor, proporciona la información faltante.');

          // Actualizar conversación
          conversation.push({ role: 'assistant', content: confirmationRequest });
          await guardarConversacion(numeroTelefono, { role: 'assistant', content: confirmationRequest });

          return { text: confirmationRequest, media: [] };
        } catch (error) {
        //  ////console.error('❌ Error en registrarJardin:', error);
          throw error;
        }

      case 'confirmarRegistro':
      //  ////console.log('🔄 Iniciando proceso de confirmación');
        try {
          // Verificar Monday SDK
          if (!initializeMondaySdk()) {
            throw new Error('Monday SDK no inicializado');
          }

          const resultado = await confirmarRegistro(chatId, numeroTelefono, conversation);
     //     ////console.log('✅ Confirmación exitosa:', resultado);
          return resultado;
        } catch (error) {
        //  ////console.error('❌ Error en confirmarRegistro:', error);
          const errorMessage = 
            '⚠️ Error al confirmar el registro:\n' +
            error.message + '\n\n' +
            'Por favor, intenta nuevamente o contacta al soporte.';
          
          conversation.push({ role: 'assistant', content: errorMessage });
          await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });
          return { text: errorMessage, media: [], error: error.message };
        }

      case 'modificarRegistro':
        return await modifyPendingRegistration(chatId, functionArgs, conversation, numeroTelefono);

      case 'consultarRegistros':
        if (!administratorNumbers.includes(numeroTelefono)) {
          const notAuthorizedMessage = '🚫 No tienes permisos para realizar esta consulta.';
          conversation.push({ role: 'assistant', content: notAuthorizedMessage });
          await guardarConversacion(numeroTelefono, { role: 'assistant', content: notAuthorizedMessage });
          return { text: notAuthorizedMessage, media: resultado.media };
        }
        return await consultarRegistros(functionArgs, conversation, numeroTelefono);
      case 'consultarMetrosCuadrados':
          if (!administratorNumbers.includes(numeroTelefono)) {
            const notAuthorizedMessage = '🚫 No tienes permisos para consultar metros cuadrados.';
            conversation.push({ role: 'assistant', content: notAuthorizedMessage });
            await guardarConversacion(numeroTelefono, { role: 'assistant', content: notAuthorizedMessage });
            return { text: notAuthorizedMessage, media: [] };
          }
        
          try {
            const resultado = await consultarMetrosCuadrados(functionArgs);
            
            if (!resultado.success) {
              conversation.push({ role: 'assistant', content: resultado.message });
              await guardarConversacion(numeroTelefono, { role: 'assistant', content: resultado.message });
              return { text: resultado.message, media: [] };
            }
        
            conversation.push({ role: 'assistant', content: resultado.message });
            await guardarConversacion(numeroTelefono, { 
              role: 'assistant', 
              content: resultado.message,
              metadata: resultado.datos
            });
        
            return { text: resultado.message, media: [] };
          } catch (error) {
            ////console.error('Error en consultarMetrosCuadrados:', error);
            const errorMessage = 'Error al procesar la consulta de metros cuadrados.';
            conversation.push({ role: 'assistant', content: errorMessage });
            await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });
            return { text: errorMessage, media: [] };
          }
          break;
          if (!administratorNumbers.includes(numeroTelefono)) {
            const notAuthorizedMessage = '🚫 No tienes permisos para consultar metros cuadrados.';
            conversation.push({ role: 'assistant', content: notAuthorizedMessage });
            await guardarConversacion(numeroTelefono, { 
              role: 'assistant', 
              content: notAuthorizedMessage 
            });
            return { text: notAuthorizedMessage, media: [] };
          }
        
          try {
            const resultado = await consultarMetrosCuadrados(functionArgs);
            
            if (!resultado.success) {
              return { 
                text: resultado.message, 
                media: [] 
              };
            }
        
            // Formatear respuesta según el tipo solicitado
            const respuesta = resultado.datos.formatoRespuesta === 'detallado' ?
              formatearRespuestaDetallada(resultado.datos) :
              formatearRespuestaResumida(resultado.datos);
        
            conversation.push({ role: 'assistant', content: respuesta });
            await guardarConversacion(numeroTelefono, { 
              role: 'assistant', 
              content: respuesta,
              metadata: resultado.datos
            });
        
            return { text: respuesta, media: [] };
          } catch (error) {
            ////console.error('Error en consultarMetrosCuadrados:', error);
            return { 
              text: 'Error al procesar la consulta de metros cuadrados.', 
              media: [] 
            };
          }
          break;
          case 'registrarPrograma':
            return await registrarPrograma(chatId, functionArgs, conversation, numeroTelefono);
          case 'modificarRegistroPrograma':
            return await modifyPendingProgramaRegistration(chatId, functionArgs, conversation, numeroTelefono);
          case 'confirmarRegistroPrograma':
            return await confirmarRegistroPrograma(chatId, numeroTelefono, conversation);
            case 'consultarProgramas':
              if (!administratorNumbers.includes(numeroTelefono)) {
                const notAuthorizedMessage = '🚫 No tienes permisos para consultar programas.';
                conversation.push({ role: 'assistant', content: notAuthorizedMessage });
                await guardarConversacion(numeroTelefono, { role: 'assistant', content: notAuthorizedMessage });
                return { text: notAuthorizedMessage, media: [] };
              }
              return await consultarProgramas(functionArgs, conversation, numeroTelefono);
            default:
        const unsupportedMessage = '❌ Función no soportada: ' + functionName;
        conversation.push({ role: 'assistant', content: unsupportedMessage });
        await guardarConversacion(numeroTelefono, { role: 'assistant', content: unsupportedMessage });
        return { text: unsupportedMessage, media: [] };
    }
  } catch (error) {
    ////console.error('❌ Error crítico en handleFunctionCall:', error);
    const criticalError = 
      '⚠️ Error crítico del sistema:\n' +
      'Por favor, contacta al soporte técnico.\n' +
      `Referencia: ${new Date().toISOString()}`;
    
    conversation.push({ role: 'assistant', content: criticalError });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: criticalError });
    return { text: criticalError, media: [], error: error.message };
  }
}


function formatearRespuestaDetallada(datos) {
  let respuesta = `📊 Resumen de trabajo de ${datos.operador}\n`;
  respuesta += `📅 Período: ${datos.periodo}\n`;
  respuesta += `🏗️ Total metros cuadrados: ${datos.totalMetros}m²\n`;
  respuesta += `📝 Registros procesados: ${datos.registros.length}\n\n`;

  datos.registros.forEach((reg, index) => {
    respuesta += `${index + 1}. ${reg.fecha.toLocaleDateString()} - ${reg.plaza}\n`;
    respuesta += `   📏 ${reg.metrosCuadrados}m²\n`;
    respuesta += `   📝 ${reg.observaciones}\n\n`;
  });

  respuesta += `📈 Promedio diario: ${Math.round(datos.promedioDiario)}m²\n`;
  respuesta += `🎯 Mayor área en un día: ${datos.mayorArea}m²`;

  return respuesta;
}

function formatearRespuestaResumida(datos) {
  return `📊 Resumen de ${datos.operador}\n` +
         `📅 ${datos.periodo}\n` +
         `🏗️ Total: ${datos.totalMetros}m²\n` +
         `📝 Registros: ${datos.registros.length}\n` +
         `📈 Promedio: ${Math.round(datos.promedioDiario)}m²/día`;
}
async function uploadMediaToWhatsApp(imageData, mimeType) {
  try {
    // Asegurarnos de que imageData sea un Buffer
    const buffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData);
    
    // Crear un nuevo FormData
    const form = new FormData();
    
    // Añadir el buffer como un archivo
    form.append('file', buffer, {
      filename: `image_${Date.now()}.jpg`,
      contentType: 'image/jpeg',
      knownLength: buffer.length
    });

    // Usar axios para la solicitud
    const response = await axios.post(`${config.apiUrl}/media`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/json'
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    ////console.log('Upload media response:', response.data);

    if (response.data.media && response.data.media[0] && response.data.media[0].id) {
      return response.data.media[0].id;
    } else {
      ////console.error('Error al subir media:', response.data);
      return null;
    }
  } catch (error) {
    ////console.error('Error al subir media a WhatsApp:', error);
    if (error.response) {
      ////console.error('Response data:', error.response.data);
      ////console.error('Response status:', error.response.status);
    }
    return null;
  }
}


async function handleAudioMessage(message, chatId, numeroTelefono, userType) {
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

    const responseObj = await getLLMResponse(chatId, transcription, numeroTelefono, userType);

    if (responseObj && responseObj.text) {
      await sendWhapiRequest('messages/text', { to: chatId, body: responseObj.text });

      // Si hay medios, enviarlos
      if (responseObj.media && responseObj.media.length > 0) {
        for (const mediaItem of responseObj.media) {
          if (mediaItem.data) {
            const base64Image = Buffer.from(mediaItem.data).toString('base64');
            await sendImage(
              numeroTelefono,
              base64Image,
              mediaItem.mimeType || 'image/jpeg',
              100,
              100,
              'Imagen del registro'
            );
          }
        }
      }
    } else {
      const errorMessage = 'Lo siento, ha ocurrido un error al procesar tu mensaje.';
      await sendWhapiRequest('messages/text', { to: chatId, body: errorMessage });
    }
    // Si hay medios en la respuesta, ya fueron manejados en getLLMResponse
  } catch (error) {
    ////console.error('Error al procesar el mensaje de audio:', error);
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
    ////console.log('Transcripción:', transcription);
    return transcription;
  } catch (error) {
    ////console.error('Error al transcribir el audio:', error);
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
      responseType: 'arraybuffer', // Esto asegura que recibimos los datos como Buffer
    });
    return Buffer.from(response.data); // Retornar datos binarios como Buffer
  } catch (error) {
    throw new Error(`Error al descargar la imagen: ${error.message}`);
  }
}
async function uploadMediaToWhatsApp(imageData, mimeType) {
  try {
    // Asegurarnos de que imageData sea un Buffer
    const buffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData);
    
    // Crear un nuevo FormData
    const form = new FormData();
    
    // Añadir el buffer como un archivo
    form.append('file', buffer, {
      filename: `image_${Date.now()}.${mimeType.split('/')[1]}`,
      contentType: mimeType,
      knownLength: buffer.length
    });

    const response = await fetch(`${config.apiUrl}/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        ...form.getHeaders()
      },
      body: form
    });

    const json = await response.json();
    ////console.log('Upload media response:', json);

    if (json.media && json.media[0] && json.media[0].id) {
      return json.media[0].id;
    } else {
      ////console.error('Error al subir media:', json);
      return null;
    }
  } catch (error) {
    ////console.error('Error al subir media a WhatsApp:', error);
    return null;
  }
}

async function sendWhapiRequest(endpoint, params = {}, method = 'POST') {
  try {
    if (endpoint === 'messages/image') {
      const response = await axios.post(`${config.apiUrl}/${endpoint}`, {
        to: params.to,
        image: {
          id: params.media_id
        }
      }, {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json'
        }
      });
      ////console.log('Whapi response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } else if (endpoint === 'messages/text') {
      const response = await axios.post(`${config.apiUrl}/${endpoint}`, {
        to: params.to,
        body: params.body
      }, {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json'
        }
      });
      ////console.log('Whapi response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } else if (params?.media) {
      const form = new FormData();
      for (const [key, value] of Object.entries(params)) {
        if (Buffer.isBuffer(value)) {
          form.append(key, value, {
            filename: `file_${Date.now()}`,
            contentType: params.contentType || 'application/octet-stream'
          });
        } else {
          form.append(key, value);
        }
      }
      
      const response = await axios.post(`${config.apiUrl}/${endpoint}`, form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/json'
        }
      });
      ////console.log('Whapi response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } else {
      const response = await axios({
        method,
        url: `${config.apiUrl}/${endpoint}`,
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json'
        },
        data: params
      });
      ////console.log('Whapi response:', JSON.stringify(response.data, null, 2));
      return response.data;
    }
  } catch (error) {
    ////console.error('Error en sendWhapiRequest:', error);
    if (error.response) {
      ////console.error('Response data:', error.response.data);
      ////console.error('Response status:', error.response.status);
    }
    throw error;
  }
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
checkMondayConfiguration().then(isConfigured => {
  if (isConfigured) {
    ////console.log('✅ Monday.com configurado correctamente');
  } else {
    ////console.log('⚠️ Monday.com no está configurado correctamente');
  }
});


const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => res.send('Bot is running'));
app.post('/hook/messages', handleNewMessages);
app.use((req, res, next) => {
  ////console.log('🔄 Nueva solicitud:', {
   // path: req.path,
  //  method: req.method,
  //  timestamp: new Date().toISOString()
//  });
  next();
});
verifyMondayColumns();
//populateCuadrantes();

setHook().then(() => {
  const port = config.port || (config.botUrl.indexOf('https:') === 0 ? 443 : 80);
  app.listen(port, () => console.log(`Listening on port ${port}...`));
});
