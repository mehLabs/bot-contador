import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { AdviceExpense, BudgetSummaryCategory, FixedExpenseSummary, IncomeSummary } from '../db/repository.js';
import { sanitizeFilePart } from '../utils/format.js';

export async function createAvailabilityReport(input: {
  reportsDir: string;
  period: string;
  currency: string;
  total: number;
  spent: number;
  fixedSpent?: number;
  variableSpent?: number;
  remaining: number;
  categories: BudgetSummaryCategory[];
  fixedExpenses?: FixedExpenseSummary[];
  incomes?: IncomeSummary[];
  adjustments?: AdviceExpense[];
}): Promise<string> {
  fs.mkdirSync(input.reportsDir, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'bot-contador';
  workbook.created = new Date();

  const summary = workbook.addWorksheet('Resumen');
  summary.columns = [
    { header: 'Concepto', key: 'label', width: 28 },
    { header: 'Importe', key: 'value', width: 18 }
  ];
  summary.addRows([
    { label: 'Periodo', value: input.period },
    { label: 'Presupuesto total', value: input.total },
    { label: 'Gastado variable', value: input.variableSpent ?? input.spent },
    { label: 'Gastos fijos', value: input.fixedSpent ?? 0 },
    { label: 'Gastado total', value: input.spent },
    { label: 'Disponible', value: input.remaining }
  ]);
  styleSheet(summary);
  summary.getColumn('value').numFmt = '"$"#,##0';

  const categories = workbook.addWorksheet('Categorías');
  categories.columns = [
    { header: 'Categoría', key: 'name', width: 24 },
    { header: 'Tipo', key: 'kind', width: 14 },
    { header: 'Persona', key: 'personName', width: 20 },
    { header: 'Presupuesto', key: 'limit', width: 16 },
    { header: 'Gastado', key: 'spent', width: 16 },
    { header: 'Disponible', key: 'remaining', width: 16 }
  ];
  categories.addRows(input.categories);
  styleSheet(categories);
  for (const column of ['limit', 'spent', 'remaining']) {
    categories.getColumn(column).numFmt = '"$"#,##0';
  }

  const fixed = workbook.addWorksheet('Gastos fijos');
  fixed.columns = [
    { header: 'Nombre', key: 'name', width: 28 },
    { header: 'Importe', key: 'amount', width: 16 },
    { header: 'Origen', key: 'source', width: 16 }
  ];
  fixed.addRows(input.fixedExpenses ?? []);
  styleSheet(fixed);
  fixed.getColumn('amount').numFmt = '"$"#,##0';

  const incomes = workbook.addWorksheet('Ingresos');
  incomes.columns = [
    { header: 'Descripción', key: 'description', width: 32 },
    { header: 'Categoría', key: 'category', width: 22 },
    { header: 'Importe', key: 'amount', width: 16 },
    { header: 'Fecha', key: 'incomeDate', width: 14 }
  ];
  incomes.addRows(input.incomes ?? []);
  styleSheet(incomes);
  incomes.getColumn('amount').numFmt = '"$"#,##0';

  const adjustments = workbook.addWorksheet('Ajustes');
  adjustments.columns = [
    { header: 'ID', key: 'publicId', width: 14 },
    { header: 'Descripción', key: 'description', width: 36 },
    { header: 'Importe', key: 'amount', width: 16 },
    { header: 'Estado', key: 'status', width: 14 },
    { header: 'Fecha', key: 'expenseDate', width: 14 }
  ];
  adjustments.addRows(input.adjustments ?? []);
  styleSheet(adjustments);
  adjustments.getColumn('amount').numFmt = '"$"#,##0';

  const filePath = path.join(input.reportsDir, `disponibilidad-${sanitizeFilePart(input.period)}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

function styleSheet(sheet: ExcelJS.Worksheet): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  header.alignment = { vertical: 'middle' };
  sheet.eachRow((row) => {
    row.height = 22;
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
    });
  });
}
