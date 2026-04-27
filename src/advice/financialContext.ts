import { Repository } from '../db/repository.js';

export type FinancialAdviceContext = {
  generatedAt: string;
  currentPeriod: ReturnType<Repository['financialContextForCurrentPeriod']>;
  recentExpenses: ReturnType<Repository['recentExpensesForAdvice']>;
  categoryTrends: ReturnType<Repository['categoryTrends']>;
  goals: ReturnType<Repository['goals']>;
  alerts: string[];
};

export class FinancialContextBuilder {
  constructor(private readonly repo: Repository) {}

  build(): FinancialAdviceContext {
    const currentPeriod = this.repo.financialContextForCurrentPeriod();
    const recentExpenses = this.repo.recentExpensesForAdvice(12);
    const categoryTrends = this.repo.categoryTrends(3);
    const goals = this.repo.goals('active');
    const alerts: string[] = [];

    if (!currentPeriod) {
      alerts.push('No hay presupuesto configurado para el periodo actual.');
    } else {
      if (currentPeriod.remaining < 0) alerts.push('El presupuesto general está excedido.');
      for (const category of currentPeriod.categories) {
        if (category.remaining < 0) alerts.push(`La categoría ${category.name} está excedida.`);
        else if (category.limit > 0 && category.spent / category.limit >= 0.8) alerts.push(`La categoría ${category.name} ya consumió al menos el 80% de su presupuesto.`);
      }
      for (const adjustment of currentPeriod.adjustments) {
        if (adjustment.status === 'active') alerts.push(`Hay un ajuste desconocido activo por ${adjustment.amount}; revisar disciplina de registro.`);
      }
    }
    for (const goal of goals) {
      if (goal.horizon === 'short') alerts.push(`Meta de corto plazo activa: ${goal.title}. Debe considerarse en el análisis.`);
    }

    return {
      generatedAt: new Date().toISOString(),
      currentPeriod,
      recentExpenses,
      categoryTrends,
      goals,
      alerts
    };
  }
}
