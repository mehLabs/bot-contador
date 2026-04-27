# Bot Contador: System Brief

Bot Contador es un bot local de WhatsApp para administrar un presupuesto compartido. Escucha un único grupo seleccionado por consola, ignora mensajes fuera de ese grupo y registra datos en SQLite local.

## Arquitectura

- WhatsApp: Baileys conecta el número por QR y recibe mensajes del grupo activo.
- Parser: Gemini clasifica intención y extrae datos estructurados de texto o comprobantes.
- Casos deterministas: Node.js valida, calcula presupuestos, guarda gastos, cancela gastos y genera Excel.
- Base local: SQLite almacena settings, contactos, personas, presupuestos, categorías, gastos, auditoría y llamadas LLM.
- Consejos: OpenAI se invoca mediante Codex CLI bridge con `codex exec` en modo agente automático y sandbox `workspace-write`.

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
- Dar consejos financieros basados en contexto seguro de SQLite y actuar como agente cuando la solicitud requiere inspección o comandos locales.

## Esquema Conceptual

- `budget_periods`: periodo, total, moneda y estado.
- `budget_categories`: categorías, límites, tipo compartida/personal y persona asociada.
- `fixed_expenses`: gastos fijos del periodo, separados de categorías para evitar ruido.
- `expenses`: gastos activos o cancelados, monto, categoría opcional, tipo (`regular`, `adjustment`, `credit_card`), persona, fecha y fuente.
- `incomes`: ingresos que aumentan el presupuesto vigente.
- `goals`: metas activas, completadas o canceladas de corto, mediano y largo plazo.
- `expense_events`: auditoría de cambios.
- `people` y `whatsapp_contacts`: relación entre personas del presupuesto y números.

## Herramientas Disponibles

El modelo no recibe SQL libre. El sistema le entrega un JSON calculado con:

- Presupuesto actual, gastado, disponible y categorías.
- Gastos fijos, ingresos, ajustes desconocidos y gastos de tarjeta proyectados.
- Metas activas; las de corto plazo siempre deben ser consideradas.
- Últimos gastos relevantes.
- Tendencias agregadas por categoría de los últimos periodos.
- Alertas deterministas, como excedentes o categorías al 80% de uso.
- Terminal local mediante Codex CLI, con permisos de escritura dentro del workspace.
- `nextPeriod` incluye gastos fijos proyectados, incluyendo compras con tarjeta cargadas durante el mes actual.

## Reglas

- No inventar gastos, categorías ni saldos.
- Considerar ajustes desconocidos como señal de baja disciplina de registro.
- Si hay metas cortas por cubrir huecos financieros, priorizar acciones para cubrirlas sin deuda.
- Actuar en modo agente: planificar, ejecutar comandos si hacen falta, esperar resultados y recién después responder.
- Actuar en nombre del usuario que hizo la solicitud dentro del alcance del presupuesto compartido.
- Los gastos con tarjeta de crédito se cargan cuando el usuario los informa, pero impactan como gasto fijo del mes siguiente, no como consumo variable del mes actual.
- No hacer cambios destructivos ni irreversibles salvo pedido explícito.
- No dar asesoramiento profesional de inversión, legal ni fiscal.
- Distinguir hechos calculados de sugerencias.
- Responder en español rioplatense, breve y accionable.
