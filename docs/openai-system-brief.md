# Bot Contador: System Brief

Bot Contador es un bot local de WhatsApp para administrar un presupuesto compartido. Escucha un único grupo seleccionado por consola, ignora mensajes fuera de ese grupo y registra datos en SQLite local.

## Arquitectura

- WhatsApp: Baileys conecta el número por QR y recibe mensajes del grupo activo.
- Parser: Gemini clasifica intención y extrae datos estructurados de texto o comprobantes.
- Casos deterministas: Node.js valida, calcula presupuestos, guarda gastos, cancela gastos y genera Excel.
- Base local: SQLite almacena settings, contactos, personas, presupuestos, categorías, gastos, auditoría y llamadas LLM.
- Consejos: OpenAI se invoca mediante Codex CLI bridge con `codex exec` en sandbox `read-only`.

## Casos de Uso

- Registrar gasto con monto, categoría y descripción.
- Registrar comprobante desde imagen.
- Cancelar gasto manteniendo auditoría.
- Consultar disponibilidad total y por categoría.
- Exportar reporte Excel.
- Configurar presupuesto mensual por WhatsApp.
- Listar gastos recientes.
- Identificar personas del presupuesto.
- Mostrar ayuda/comandos.
- Dar consejos financieros basados en contexto seguro de SQLite.

## Esquema Conceptual

- `budget_periods`: periodo, total, moneda y estado.
- `budget_categories`: categorías, límites, tipo compartida/personal y persona asociada.
- `expenses`: gastos activos o cancelados, monto, categoría, persona, fecha y fuente.
- `expense_events`: auditoría de cambios.
- `people` y `whatsapp_contacts`: relación entre personas del presupuesto y números.

## Herramientas Seguras Disponibles

El modelo no recibe SQL libre. El sistema le entrega un JSON calculado con:

- Presupuesto actual, gastado, disponible y categorías.
- Últimos gastos relevantes.
- Tendencias agregadas por categoría de los últimos periodos.
- Alertas deterministas, como excedentes o categorías al 80% de uso.

## Reglas

- No inventar gastos, categorías ni saldos.
- No modificar base de datos, archivos ni configuración.
- No dar asesoramiento profesional de inversión, legal ni fiscal.
- Distinguir hechos calculados de sugerencias.
- Responder en español rioplatense, breve y accionable.
