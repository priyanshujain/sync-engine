import { Account, AccountType } from '../models/account';
import { Transaction, TransactionStatus } from '../models/transaction';
import { IndexedDBStore } from '../../../src/storage/indexed-db-store';
import { IndexedBaseModel } from '../../../src/models/indexed-base-model';
import { ModelRegistry, ModelMetadata } from '../../../src/model-registry';

/**
 * Trial Balance entry
 */
export interface TrialBalanceEntry {
  account: Account;
  debit: number;
  credit: number;
}

/**
 * Balance Sheet entry
 */
export interface BalanceSheetData {
  assets: Account[];
  liabilities: Account[];
  equity: Account[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

/**
 * Income Statement data
 */
export interface IncomeStatementData {
  revenue: Account[];
  expenses: Account[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
}

/**
 * General Ledger service
 * Provides high-level accounting operations
 */
export class GeneralLedger {
  private store: IndexedDBStore;
  private isInitialized: boolean = false;

  constructor() {
    this.store = new IndexedDBStore();
  }

  /**
   * Initialize the General Ledger with IndexedDB storage
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Define model metadata for storage
    const accountMetadata: ModelMetadata = {
      name: 'Account',
      loadStrategy: 'full',
      schemaVersion: 1,
      properties: new Map([
        ['code', { type: 'property', indexed: true }],
        ['name', { type: 'property', indexed: false }],
        ['type', { type: 'property', indexed: true }],
        ['normalBalance', { type: 'property', indexed: false }],
        ['parentId', { type: 'property', indexed: true }],
        ['isActive', { type: 'property', indexed: true }],
        ['balance', { type: 'property', indexed: false }],
        ['description', { type: 'property', indexed: false }]
      ])
    };

    const transactionMetadata: ModelMetadata = {
      name: 'Transaction',
      loadStrategy: 'full',
      schemaVersion: 1,
      properties: new Map([
        ['date', { type: 'property', indexed: true }],
        ['description', { type: 'property', indexed: false }],
        ['reference', { type: 'property', indexed: true }],
        ['entries', { type: 'property', indexed: false }],
        ['status', { type: 'property', indexed: true }],
        ['postedAt', { type: 'property', indexed: true }],
        ['postedBy', { type: 'property', indexed: true }]
      ])
    };

    // Initialize IndexedDB with models
    await this.store.initialize([accountMetadata, transactionMetadata]);
    
    // Set store in base models
    IndexedBaseModel.setStore(this.store);

    // Register models in registry
    ModelRegistry.registerModel('Account', Account as any);
    ModelRegistry.registerModel('Transaction', Transaction as any);

    // Register properties
    for (const [propName, propMeta] of accountMetadata.properties) {
      ModelRegistry.registerProperty('Account', propName, propMeta);
    }
    
    for (const [propName, propMeta] of transactionMetadata.properties) {
      ModelRegistry.registerProperty('Transaction', propName, propMeta);
    }

    this.isInitialized = true;
  }

  /**
   * Create a chart of accounts with basic structure
   */
  async createBasicChartOfAccounts(): Promise<Account[]> {
    const accounts: Account[] = [];

    // Assets
    const cash = await Account.create({
      code: '1000',
      name: 'Cash',
      type: AccountType.ASSET,
      description: 'Petty cash and bank accounts'
    });
    accounts.push(cash);

    const accountsReceivable = await Account.create({
      code: '1200',
      name: 'Accounts Receivable',
      type: AccountType.ASSET,
      description: 'Money owed by customers'
    });
    accounts.push(accountsReceivable);

    const inventory = await Account.create({
      code: '1300',
      name: 'Inventory',
      type: AccountType.ASSET,
      description: 'Goods for sale'
    });
    accounts.push(inventory);

    // Liabilities
    const accountsPayable = await Account.create({
      code: '2000',
      name: 'Accounts Payable',
      type: AccountType.LIABILITY,
      description: 'Money owed to suppliers'
    });
    accounts.push(accountsPayable);

    const salesTax = await Account.create({
      code: '2100',
      name: 'Sales Tax Payable',
      type: AccountType.LIABILITY,
      description: 'Sales tax collected from customers'
    });
    accounts.push(salesTax);

    // Equity
    const ownersEquity = await Account.create({
      code: '3000',
      name: "Owner's Equity",
      type: AccountType.EQUITY,
      description: 'Owner investment in the business'
    });
    accounts.push(ownersEquity);

    const retainedEarnings = await Account.create({
      code: '3200',
      name: 'Retained Earnings',
      type: AccountType.EQUITY,
      description: 'Accumulated profits'
    });
    accounts.push(retainedEarnings);

    // Revenue
    const sales = await Account.create({
      code: '4000',
      name: 'Sales Revenue',
      type: AccountType.REVENUE,
      description: 'Income from product sales'
    });
    accounts.push(sales);

    const serviceRevenue = await Account.create({
      code: '4100',
      name: 'Service Revenue',
      type: AccountType.REVENUE,
      description: 'Income from services provided'
    });
    accounts.push(serviceRevenue);

    // Expenses
    const costOfGoodsSold = await Account.create({
      code: '5000',
      name: 'Cost of Goods Sold',
      type: AccountType.EXPENSE,
      description: 'Direct cost of products sold'
    });
    accounts.push(costOfGoodsSold);

    const rent = await Account.create({
      code: '6000',
      name: 'Rent Expense',
      type: AccountType.EXPENSE,
      description: 'Monthly rent payments'
    });
    accounts.push(rent);

    const utilities = await Account.create({
      code: '6100',
      name: 'Utilities Expense',
      type: AccountType.EXPENSE,
      description: 'Electricity, water, gas'
    });
    accounts.push(utilities);

    const advertising = await Account.create({
      code: '6200',
      name: 'Advertising Expense',
      type: AccountType.EXPENSE,
      description: 'Marketing and promotion costs'
    });
    accounts.push(advertising);

    return accounts;
  }

  /**
   * Post a simple journal entry
   */
  async postJournalEntry(data: {
    date?: Date;
    description: string;
    reference?: string;
    entries: Array<{
      accountCode: string;
      debit?: number;
      credit?: number;
      description?: string;
    }>;
  }): Promise<Transaction> {
    const id = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const transaction = new Transaction(id);

    transaction.update({
      date: data.date || new Date(),
      description: data.description,
      reference: data.reference
    });

    // Add entries
    for (const entryData of data.entries) {
      const account = await Account.findByCode(entryData.accountCode);
      if (!account) {
        throw new Error(`Account not found: ${entryData.accountCode}`);
      }

      await transaction.addEntry({
        accountId: account.id,
        debit: entryData.debit || 0,
        credit: entryData.credit || 0,
        description: entryData.description
      });
    }

    // Post the transaction
    await transaction.post();
    
    return transaction;
  }

  /**
   * Calculate trial balance
   */
  async getTrialBalance(asOfDate?: Date): Promise<TrialBalanceEntry[]> {
    const cutoffDate = asOfDate || new Date();
    const accounts = await Account.getActiveAccounts();
    const trialBalance: TrialBalanceEntry[] = [];

    for (const account of accounts) {
      const transactions = await Transaction.getForAccount(account.id);
      
      let totalDebits = 0;
      let totalCredits = 0;

      for (const transaction of transactions) {
        if (transaction.date <= cutoffDate && transaction.status === TransactionStatus.POSTED) {
          for (const entry of transaction.entries) {
            if (entry.accountId === account.id) {
              totalDebits += entry.debit;
              totalCredits += entry.credit;
            }
          }
        }
      }

      if (totalDebits > 0 || totalCredits > 0) {
        trialBalance.push({
          account,
          debit: totalDebits,
          credit: totalCredits
        });
      }
    }

    return trialBalance.sort((a, b) => a.account.code.localeCompare(b.account.code));
  }

  /**
   * Generate Balance Sheet
   */
  async getBalanceSheet(asOfDate?: Date): Promise<BalanceSheetData> {
    const trialBalance = await this.getTrialBalance(asOfDate);
    
    const assets: Account[] = [];
    const liabilities: Account[] = [];
    const equity: Account[] = [];
    
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const entry of trialBalance) {
      const balance = entry.account.normalBalance === 'debit' 
        ? entry.debit - entry.credit
        : entry.credit - entry.debit;

      // Update account balance for display
      entry.account.balance = balance;

      switch (entry.account.type) {
        case AccountType.ASSET:
          if (balance > 0) {
            assets.push(entry.account);
            totalAssets += balance;
          }
          break;
        case AccountType.LIABILITY:
          if (balance > 0) {
            liabilities.push(entry.account);
            totalLiabilities += balance;
          }
          break;
        case AccountType.EQUITY:
          if (balance > 0) {
            equity.push(entry.account);
            totalEquity += balance;
          }
          break;
      }
    }

    return {
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity
    };
  }

  /**
   * Generate Income Statement
   */
  async getIncomeStatement(startDate: Date, endDate: Date): Promise<IncomeStatementData> {
    const transactions = await Transaction.getForDateRange(startDate, endDate);
    const revenue: Account[] = [];
    const expenses: Account[] = [];
    
    // Track account balances for the period
    const accountBalances = new Map<string, number>();

    for (const transaction of transactions) {
      for (const entry of transaction.entries) {
        const account = await Account.load(entry.accountId);
        if (account && (account.type === AccountType.REVENUE || account.type === AccountType.EXPENSE)) {
          const currentBalance = accountBalances.get(account.id) || 0;
          const entryAmount = account.normalBalance === 'credit' 
            ? entry.credit - entry.debit
            : entry.debit - entry.credit;
          
          accountBalances.set(account.id, currentBalance + entryAmount);
        }
      }
    }

    let totalRevenue = 0;
    let totalExpenses = 0;

    for (const [accountId, balance] of accountBalances) {
      const account = await Account.load(accountId);
      if (account && balance > 0) {
        account.balance = balance;

        if (account.type === AccountType.REVENUE) {
          revenue.push(account);
          totalRevenue += balance;
        } else if (account.type === AccountType.EXPENSE) {
          expenses.push(account);
          totalExpenses += balance;
        }
      }
    }

    return {
      revenue,
      expenses,
      totalRevenue,
      totalExpenses,
      netIncome: totalRevenue - totalExpenses
    };
  }

  /**
   * Get account balance as of date
   */
  async getAccountBalance(accountCode: string, asOfDate?: Date): Promise<number> {
    const account = await Account.findByCode(accountCode);
    if (!account) {
      throw new Error(`Account not found: ${accountCode}`);
    }

    // If no cutoff date specified, use the cached balance (which includes void reversals)
    if (!asOfDate) {
      return account.balance;
    }

    // For historical balance, calculate from transactions (excluding void)
    const cutoffDate = asOfDate;
    const transactions = await Transaction.getForAccount(account.id);
    
    let totalDebits = 0;
    let totalCredits = 0;

    for (const transaction of transactions) {
      if (transaction.date <= cutoffDate && transaction.status === TransactionStatus.POSTED) {
        for (const entry of transaction.entries) {
          if (entry.accountId === account.id) {
            totalDebits += entry.debit;
            totalCredits += entry.credit;
          }
        }
      }
    }

    return account.normalBalance === 'debit' 
      ? totalDebits - totalCredits
      : totalCredits - totalDebits;
  }

  /**
   * Validate double-entry bookkeeping integrity
   */
  async validateIntegrity(): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const trialBalance = await this.getTrialBalance();
      
      let totalDebits = 0;
      let totalCredits = 0;

      for (const entry of trialBalance) {
        totalDebits += entry.debit;
        totalCredits += entry.credit;
      }

      // Check if books balance
      const difference = Math.abs(totalDebits - totalCredits);
      if (difference > 0.01) { // Allow for rounding differences
        errors.push(`Books do not balance. Difference: ${difference.toFixed(2)}`);
      }

      // Check for unbalanced transactions
      const allTransactions = await Transaction.getPosted();
      for (const transaction of allTransactions) {
        if (!transaction.isBalanced) {
          errors.push(`Unbalanced transaction: ${transaction.id} (${transaction.description})`);
        }
      }

    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    accounts: number;
    transactions: number;
    draftTransactions: number;
    postedTransactions: number;
  }> {
    return {
      accounts: await Account.count(),
      transactions: await Transaction.count(),
      draftTransactions: (await Transaction.getDrafts()).length,
      postedTransactions: (await Transaction.getPosted()).length
    };
  }

  /**
   * Close the storage connection
   */
  close(): void {
    this.store.close();
    this.isInitialized = false;
  }
}