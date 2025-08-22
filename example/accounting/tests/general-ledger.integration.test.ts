import 'fake-indexeddb/auto';
import { GeneralLedger } from '../services/general-ledger';
import { Account, AccountType } from '../models/account';
import { Transaction, TransactionStatus } from '../models/transaction';

describe('General Ledger Integration', () => {
  let ledger: GeneralLedger;

  beforeEach(async () => {
    // Clear all databases before each test
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name && db.name !== '') {
        await new Promise((resolve, reject) => {
          const deleteReq = indexedDB.deleteDatabase(db.name!);
          deleteReq.onsuccess = () => resolve(undefined);
          deleteReq.onerror = () => reject(deleteReq.error);
        });
      }
    }

    ledger = new GeneralLedger();
    await ledger.initialize();
  });

  afterEach(() => {
    ledger.close();
  });

  describe('Chart of Accounts', () => {
    test('creates basic chart of accounts', async () => {
      const accounts = await ledger.createBasicChartOfAccounts();
      
      expect(accounts.length).toBeGreaterThan(10);
      
      // Verify account types are created
      const assetAccounts = accounts.filter(a => a.type === AccountType.ASSET);
      const liabilityAccounts = accounts.filter(a => a.type === AccountType.LIABILITY);
      const equityAccounts = accounts.filter(a => a.type === AccountType.EQUITY);
      const revenueAccounts = accounts.filter(a => a.type === AccountType.REVENUE);
      const expenseAccounts = accounts.filter(a => a.type === AccountType.EXPENSE);
      
      expect(assetAccounts.length).toBeGreaterThan(0);
      expect(liabilityAccounts.length).toBeGreaterThan(0);
      expect(equityAccounts.length).toBeGreaterThan(0);
      expect(revenueAccounts.length).toBeGreaterThan(0);
      expect(expenseAccounts.length).toBeGreaterThan(0);
      
      // Verify cash account exists
      const cashAccount = await Account.findByCode('1000');
      expect(cashAccount).toBeDefined();
      expect(cashAccount!.name).toBe('Cash');
      expect(cashAccount!.type).toBe(AccountType.ASSET);
      expect(cashAccount!.normalBalance).toBe('debit');
    });

    test('prevents duplicate account codes', async () => {
      await ledger.createBasicChartOfAccounts();
      
      // Try to create duplicate
      await expect(Account.create({
        code: '1000',
        name: 'Duplicate Cash',
        type: AccountType.ASSET
      })).rejects.toThrow('Account with code \'1000\' already exists');
    });
  });

  describe('Transaction Processing', () => {
    beforeEach(async () => {
      await ledger.createBasicChartOfAccounts();
    });

    test('posts simple journal entry', async () => {
      const transaction = await ledger.postJournalEntry({
        description: 'Initial capital investment',
        entries: [
          { accountCode: '1000', debit: 10000 }, // Cash
          { accountCode: '3000', credit: 10000 } // Owner's Equity
        ]
      });

      expect(transaction.status).toBe(TransactionStatus.POSTED);
      expect(transaction.isBalanced).toBe(true);
      expect(transaction.entries).toHaveLength(2);
      expect(transaction.totalDebits).toBe(10000);
      expect(transaction.totalCredits).toBe(10000);
      
      // Verify transaction was stored
      const storedTransaction = await Transaction.load(transaction.id);
      expect(storedTransaction).toBeDefined();
      expect(storedTransaction!.status).toBe(TransactionStatus.POSTED);
    });

    test('updates account balances when posting', async () => {
      // Initial balances should be 0
      let cashBalance = await ledger.getAccountBalance('1000');
      let equityBalance = await ledger.getAccountBalance('3000');
      expect(cashBalance).toBe(0);
      expect(equityBalance).toBe(0);

      // Post transaction
      await ledger.postJournalEntry({
        description: 'Initial capital investment',
        entries: [
          { accountCode: '1000', debit: 10000 }, // Cash (Asset - debit increases)
          { accountCode: '3000', credit: 10000 } // Owner's Equity (Equity - credit increases)
        ]
      });

      // Check updated balances
      cashBalance = await ledger.getAccountBalance('1000');
      equityBalance = await ledger.getAccountBalance('3000');
      expect(cashBalance).toBe(10000);
      expect(equityBalance).toBe(10000);
    });

    test('handles complex multi-entry transaction', async () => {
      const transaction = await ledger.postJournalEntry({
        description: 'Purchase inventory with cash and credit',
        reference: 'PO-001',
        entries: [
          { accountCode: '1300', debit: 5000, description: 'Inventory purchase' }, // Inventory
          { accountCode: '1000', credit: 3000, description: 'Cash payment' },      // Cash
          { accountCode: '2000', credit: 2000, description: 'Amount on credit' }   // Accounts Payable
        ]
      });

      expect(transaction.status).toBe(TransactionStatus.POSTED);
      expect(transaction.isBalanced).toBe(true);
      expect(transaction.entries).toHaveLength(3);
      expect(transaction.reference).toBe('PO-001');

      // Verify balances
      const inventoryBalance = await ledger.getAccountBalance('1300');
      const cashBalance = await ledger.getAccountBalance('1000');
      const payableBalance = await ledger.getAccountBalance('2000');
      
      expect(inventoryBalance).toBe(5000);
      expect(cashBalance).toBe(-3000); // Cash decreased
      expect(payableBalance).toBe(2000);
    });

    test('prevents posting unbalanced transactions', async () => {
      const id = 'test_unbalanced';
      const transaction = new Transaction(id);
      
      transaction.update({
        description: 'Unbalanced transaction'
      });

      await transaction.addEntry({
        accountId: 'account_1000', // Cash
        debit: 1000
      });

      await transaction.addEntry({
        accountId: 'account_3000', // Owner's Equity  
        credit: 500 // Intentionally unbalanced
      });

      await expect(transaction.post()).rejects.toThrow('Transaction is not balanced');
    });

    test('prevents modifying posted transactions', async () => {
      const transaction = await ledger.postJournalEntry({
        description: 'Posted transaction',
        entries: [
          { accountCode: '1000', debit: 1000 },
          { accountCode: '3000', credit: 1000 }
        ]
      });

      // Try to modify posted transaction
      expect(() => {
        transaction.update({ description: 'Modified description' });
      }).toThrow('Cannot modify posted or voided transactions');

      await expect(transaction.addEntry({
        accountId: 'account_1000',
        debit: 100
      })).rejects.toThrow('Cannot modify posted or voided transactions');
    });
  });

  describe('Transaction Voiding', () => {
    beforeEach(async () => {
      await ledger.createBasicChartOfAccounts();
    });

    test('voids posted transaction and reverses balances', async () => {
      // Post transaction
      const transaction = await ledger.postJournalEntry({
        description: 'Transaction to be voided',
        entries: [
          { accountCode: '1000', debit: 1000 },
          { accountCode: '3000', credit: 1000 }
        ]
      });

      // Check balances after posting
      let cashBalance = await ledger.getAccountBalance('1000');
      expect(cashBalance).toBe(1000);

      // Void the transaction
      await transaction.void('Posted to wrong account', 'user123');

      expect(transaction.status).toBe(TransactionStatus.VOID);
      expect(transaction.voidReason).toBe('Posted to wrong account');
      expect(transaction.voidedBy).toBe('user123');
      expect(transaction.voidedAt).toBeDefined();

      // Check balances after voiding - should be back to 0
      cashBalance = await ledger.getAccountBalance('1000');
      const equityBalance = await ledger.getAccountBalance('3000');
      expect(cashBalance).toBe(0);
      expect(equityBalance).toBe(0);
    });

    test('prevents voiding non-posted transactions', async () => {
      const id = 'test_draft';
      const transaction = new Transaction(id);
      
      await expect(transaction.void('Test reason')).rejects.toThrow('Only posted transactions can be voided');
    });

    test('requires void reason', async () => {
      const transaction = await ledger.postJournalEntry({
        description: 'Transaction to be voided',
        entries: [
          { accountCode: '1000', debit: 1000 },
          { accountCode: '3000', credit: 1000 }
        ]
      });

      await expect(transaction.void('')).rejects.toThrow('Void reason is required');
    });
  });

  describe('Financial Reports', () => {
    beforeEach(async () => {
      await ledger.createBasicChartOfAccounts();
      
      // Set up some test transactions
      await ledger.postJournalEntry({
        description: 'Initial capital',
        entries: [
          { accountCode: '1000', debit: 20000 },  // Cash
          { accountCode: '3000', credit: 20000 }  // Owner's Equity
        ]
      });

      await ledger.postJournalEntry({
        description: 'Purchase inventory',
        entries: [
          { accountCode: '1300', debit: 5000 },   // Inventory
          { accountCode: '1000', credit: 5000 }   // Cash
        ]
      });

      await ledger.postJournalEntry({
        description: 'Sales revenue',
        entries: [
          { accountCode: '1000', debit: 3000 },   // Cash
          { accountCode: '4000', credit: 3000 }   // Sales Revenue
        ]
      });

      await ledger.postJournalEntry({
        description: 'Cost of goods sold',
        entries: [
          { accountCode: '5000', debit: 2000 },   // COGS
          { accountCode: '1300', credit: 2000 }   // Inventory
        ]
      });

      await ledger.postJournalEntry({
        description: 'Rent payment',
        entries: [
          { accountCode: '6000', debit: 1200 },   // Rent Expense
          { accountCode: '1000', credit: 1200 }   // Cash
        ]
      });

      await ledger.postJournalEntry({
        description: 'Purchase on credit',
        entries: [
          { accountCode: '1300', debit: 1500 },   // Inventory
          { accountCode: '2000', credit: 1500 }   // Accounts Payable
        ]
      });
    });

    test('generates trial balance', async () => {
      const trialBalance = await ledger.getTrialBalance();
      
      expect(trialBalance.length).toBeGreaterThan(0);
      
      // Calculate totals
      let totalDebits = 0;
      let totalCredits = 0;
      
      for (const entry of trialBalance) {
        totalDebits += entry.debit;
        totalCredits += entry.credit;
        
        // Each entry should have the account populated
        expect(entry.account).toBeDefined();
        expect(entry.account.code).toBeDefined();
        expect(entry.account.name).toBeDefined();
      }
      
      // Trial balance should balance
      expect(Math.abs(totalDebits - totalCredits)).toBeLessThan(0.01);
    });

    test('generates balance sheet', async () => {
      const balanceSheet = await ledger.getBalanceSheet();
      
      expect(balanceSheet.assets.length).toBeGreaterThan(0);
      expect(balanceSheet.liabilities.length).toBeGreaterThan(0);
      expect(balanceSheet.equity.length).toBeGreaterThan(0);
      
      // Balance sheet should balance: Assets = Liabilities + Equity
      // Note: In a real system, revenue/expense accounts would be closed to retained earnings
      // For this test, we accept that income statement accounts create a temporary imbalance
      const balanceDiff = Math.abs(balanceSheet.totalAssets - (balanceSheet.totalLiabilities + balanceSheet.totalEquity));
      // The difference represents net income/loss that hasn't been closed to retained earnings
      expect(balanceDiff).toBe(200); // This is the net loss (3000 revenue - 3200 expenses)
      
      // Check expected balances  
      const cashAccount = balanceSheet.assets.find(a => a.code === '1000');
      expect(cashAccount).toBeDefined();
      expect(cashAccount!.balance).toBe(16800); // 20000 - 5000 + 3000 - 1200
      
      const inventoryAccount = balanceSheet.assets.find(a => a.code === '1300');
      expect(inventoryAccount).toBeDefined();
      expect(inventoryAccount!.balance).toBe(4500); // 5000 - 2000 + 1500
    });

    test('generates income statement', async () => {
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-12-31');
      
      const incomeStatement = await ledger.getIncomeStatement(startDate, endDate);
      
      expect(incomeStatement.revenue.length).toBeGreaterThan(0);
      expect(incomeStatement.expenses.length).toBeGreaterThan(0);
      
      // Check revenue
      const salesRevenue = incomeStatement.revenue.find(a => a.code === '4000');
      expect(salesRevenue).toBeDefined();
      expect(salesRevenue!.balance).toBe(3000);
      
      // Check expenses
      const cogs = incomeStatement.expenses.find(a => a.code === '5000');
      expect(cogs).toBeDefined();
      expect(cogs!.balance).toBe(2000);
      
      const rentExpense = incomeStatement.expenses.find(a => a.code === '6000');
      expect(rentExpense).toBeDefined();
      expect(rentExpense!.balance).toBe(1200);
      
      // Check totals
      expect(incomeStatement.totalRevenue).toBe(3000);
      expect(incomeStatement.totalExpenses).toBe(3200); // 2000 + 1200
      expect(incomeStatement.netIncome).toBe(-200); // 3000 - 3200
    });

    test('validates accounting integrity', async () => {
      const validation = await ledger.validateIntegrity();
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await ledger.createBasicChartOfAccounts();
    });

    test('handles invalid account codes', async () => {
      await expect(ledger.postJournalEntry({
        description: 'Invalid transaction',
        entries: [
          { accountCode: '9999', debit: 1000 }, // Non-existent account
          { accountCode: '1000', credit: 1000 }
        ]
      })).rejects.toThrow('Account not found: 9999');
    });

    test('prevents posting to inactive accounts', async () => {
      // Deactivate cash account
      const cashAccount = await Account.findByCode('1000');
      cashAccount!.deactivate();
      await cashAccount!.save();

      await expect(ledger.postJournalEntry({
        description: 'Transaction with inactive account',
        entries: [
          { accountCode: '1000', debit: 1000 }, // Inactive account
          { accountCode: '3000', credit: 1000 }
        ]
      })).rejects.toThrow('Cannot post to inactive account');
    });

    test('validates transaction requires minimum entries', async () => {
      const id = 'test_insufficient';
      const transaction = new Transaction(id);
      
      transaction.update({
        description: 'Insufficient entries'
      });

      await transaction.addEntry({
        accountId: 'account_1000',
        debit: 1000
      });

      // Only one entry - should fail validation
      const validation = transaction.validate();
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Transaction must have at least two journal entries');
    });
  });

  describe('Multi-Client Sync Scenarios', () => {
    let ledger2: GeneralLedger;

    beforeEach(async () => {
      await ledger.createBasicChartOfAccounts();
      
      // Create second ledger instance (simulating another client)
      ledger2 = new GeneralLedger();
      await ledger2.initialize();
    });

    afterEach(() => {
      if (ledger2) {
        ledger2.close();
      }
    });

    test('both clients can access same data after sync', async () => {
      // Post transaction from first client
      const transaction1 = await ledger.postJournalEntry({
        description: 'Transaction from client 1',
        entries: [
          { accountCode: '1000', debit: 5000 },
          { accountCode: '3000', credit: 5000 }
        ]
      });

      // Second client should be able to load the transaction
      // (In a real sync scenario, this would come via sync protocol)
      const loadedTransaction = await Transaction.load(transaction1.id);
      expect(loadedTransaction).toBeDefined();
      expect(loadedTransaction!.description).toBe('Transaction from client 1');
      expect(loadedTransaction!.status).toBe(TransactionStatus.POSTED);

      // Both clients should see the same balance
      const balance1 = await ledger.getAccountBalance('1000');
      const balance2 = await ledger2.getAccountBalance('1000');
      expect(balance1).toBe(balance2);
    });

    test('detects when books are out of balance', async () => {
      // Manually create an unbalanced situation (simulating sync corruption)
      const id = 'corrupt_transaction';
      const transaction = new Transaction(id);
      
      transaction.update({ description: 'Corrupted transaction' });
      
      // Add entries that don't balance
      await transaction.addEntry({
        accountId: 'account_1000',
        debit: 1000
      });
      
      await transaction.addEntry({
        accountId: 'account_3000', 
        credit: 900 // Intentionally wrong
      });
      
      // Force the status change (bypassing normal validation)
      (transaction as any).status = TransactionStatus.POSTED;
      await transaction.save();

      // Validation should catch this
      const validation = await ledger.validateIntegrity();
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Storage Statistics', () => {
    test('reports storage statistics', async () => {
      await ledger.createBasicChartOfAccounts();
      
      // Create some draft transactions
      const draftTx1 = new Transaction('draft1');
      draftTx1.update({ description: 'Draft transaction 1' });
      await draftTx1.save();
      
      const draftTx2 = new Transaction('draft2');
      draftTx2.update({ description: 'Draft transaction 2' });
      await draftTx2.save();
      
      // Post one transaction
      await ledger.postJournalEntry({
        description: 'Posted transaction',
        entries: [
          { accountCode: '1000', debit: 1000 },
          { accountCode: '3000', credit: 1000 }
        ]
      });

      const stats = await ledger.getStorageStats();
      
      expect(stats.accounts).toBeGreaterThan(10); // From createBasicChartOfAccounts
      expect(stats.transactions).toBe(3); // 2 drafts + 1 posted
      expect(stats.draftTransactions).toBe(2);
      expect(stats.postedTransactions).toBe(1);
    });
  });
});