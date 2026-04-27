# bot-contador

Bot local de WhatsApp para presupuesto compartido. Usa Baileys para conectar por QR, Gemini para interpretar lenguaje natural/comprobantes, SQLite para persistencia y ExcelJS para reportes `.xlsx`.

## Configuración

1. Copiar `.env.example` a `.env`.
2. Completar `GEMINI_API_KEY`.
3. Ejecutar:

```bash
npm run dev
```

El bot imprime el QR en terminal. Cuando WhatsApp conecta, lista los grupos disponibles; elegí el número del grupo que debe escuchar. Todo mensaje que no venga de ese grupo se ignora.

## Comandos de consola

`groups`, `status`, `pause`, `resume`, `connect`, `disconnect`, `wa-reset`, `export`, `recent`, `openai-login`, `openai-status`, `openai-test`, `dropdb`, `help`, `exit`.

`disconnect` solo cierra la conexión local y conserva la sesión. Si WhatsApp devuelve `401` o la sesión quedó inválida, usá `wa-reset` y después `connect` para generar un QR nuevo.

Los comandos `openai-*` usan Codex CLI:

- `openai-login` ejecuta `codex login` y abre el flujo de autenticación por navegador.
- `openai-status` muestra el estado de sesión.
- `openai-test` prueba el puente de consejos con `codex exec` en modo agente automático y sandbox `workspace-write`.

El bot no lee tokens internos de Codex ni reemplaza una API key. Solo invoca el binario `codex` como proceso externo. Podés configurar `CODEX_BIN`, `CODEX_ADVICE_MODEL` y `CODEX_ADVICE_TIMEOUT_MS` en `.env`.
Cuando una consulta se deriva al agente de Codex, WhatsApp queda en estado "escribiendo" mientras el agente trabaja y ejecuta los comandos necesarios dentro del workspace.
En Windows, si `openai-login` muestra `spawn codex ENOENT`, configurá `CODEX_BIN` con la ruta completa a `codex.exe`. El bot también intenta detectarlo automáticamente dentro de la extensión de VS Code de OpenAI ChatGPT.

## Mensajes soportados

- Registrar gasto: "gasté 50000 en comida".
- Registrar gasto con tarjeta: "gasté 30000 con Visa".
- Registrar ingreso: "cobré 200000 de sueldo".
- Ajustar disponible: "me quedan 50000 pesos".
- Registrar por comprobante: enviar imagen con caption opcional.
- Cancelar gasto: "cancelá el gasto GABC12" o "borrá mi último gasto".
- Consultar disponibilidad: "cuánto queda".
- Configurar presupuesto: "presupuesto 150000, comida 20000, transporte 30000, alquiler 100000 fijo".
- Configurar presupuesto del mes siguiente: "para el mes que viene presupuesto 200000...".
- Gestionar metas: "creá una meta corta para ahorrar 100000", "listá metas", "borrá meta vacaciones".
- Listar recientes: "últimos gastos".
- Consultar ayuda: "qué podés hacer" o "comandos".
- Pedir consejos financieros: "dame consejos para no pasarme este mes".

## Verificación

```bash
npm run typecheck
npm test
npm run build
```
