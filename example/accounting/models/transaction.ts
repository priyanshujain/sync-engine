import { IndexedBaseModel } from '../../../src/models/indexed-base-model';
import { Account } from './account';
import { observable, action, computed } from 'mobx';

export enum TransactionStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  VOID = 'void'
}

/**
 * Journal Entry line item
 */
export interface JournalEntry {
  id: string;           // Unique ID for the entry
  accountId: string;    // Reference to Account
  accountCode: string;  // Denormalized for performance
  accountName: string;  // Denormalized for performance
  debit: number;        // Amount if debit (0 if credit)
  credit: number;       // Amount if credit (0 if debit)
  description?: string; // Line-level description
}

/**
 * Transaction (Journal Entry) model
 * Implements double-entry bookkeeping rules
 */
export class Transaction extends IndexedBaseModel {
  @observable date: Date = new Date();
  @observable description: string = '';
  @observable reference?: string; // Check number, invoice number, etc.
  @observable entries: JournalEntry[] = [];
  @observable status: TransactionStatus = TransactionStatus.DRAFT;
  @observable postedAt?: Date;
  @observable postedBy?: string; // User ID
  @observable voidedAt?: Date;
  @observable voidedBy?: string;
  @observable voidReason?: string;

  constructor(id: string) {
    super(id, {
      autoSave: false, // Don't auto-save drafts, require explicit posting
      trackChanges: true,
      optimisticUpdate: true
    });
  }

  /**
   * Computed: Total debits
   */
  @computed
  get totalDebits(): number {
    return this.entries.reduce((sum, entry) => sum + entry.debit, 0);
  }

  /**
   * Computed: Total credits  
   */
  @computed
  get totalCredits(): number {
    return this.entries.reduce((sum, entry) => sum + entry.credit, 0);
  }

  /**
   * Computed: Check if transaction is balanced
   */
  @computed
  get isBalanced(): boolean {
    const debits = Math.round(this.totalDebits * 100);
    const credits = Math.round(this.totalCredits * 100);
    return debits === credits && debits > 0;
  }

  /**
   * Computed: Balance difference (should be 0 for balanced transactions)
   */
  @computed
  get balanceDifference(): number {
    return this.totalDebits - this.totalCredits;
  }

  /**
   * Update transaction properties
   */
  @action
  update(data: {
    date?: Date;
    description?: string;
    reference?: string;
  }): void {
    if (this.status !== TransactionStatus.DRAFT) {
      throw new Error('Cannot modify posted or voided transactions');
    }

    if (data.date !== undefined) this.date = data.date;
    if (data.description !== undefined) this.description = data.description;
    if (data.reference !== undefined) this.reference = data.reference;

    this.markDirty();
  }

  /**
   * Add a journal entry
   */
  @action
  async addEntry(entry: {
    accountId: string;
    debit?: number;
    credit?: number;
    description?: string;
  }): Promise<void> {
    if (this.status !== TransactionStatus.DRAFT) {
      throw new Error('Cannot modify posted or voided transactions');
    }

    // Validate amounts
    const debit = entry.debit || 0;
    const credit = entry.credit || 0;

    if (debit < 0 || credit < 0) {
      throw new Error('Debit and credit amounts must be positive');
    }

    if (debit > 0 && credit > 0) {
      throw new Error('An entry cannot have both debit and credit amounts');
    }

    if (debit === 0 && credit === 0) {
      throw new Error('An entry must have either a debit or credit amount');
    }

    // Get account information
    const account = await Account.load(entry.accountId);
    if (!account) {
      throw new Error(`Account not found: ${entry.accountId}`);
    }

    if (!account.canPost()) {
      throw new Error(`Cannot post to inactive account: ${account.code} - ${account.name}`);
    }

    const journalEntry: JournalEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      accountId: entry.accountId,
      accountCode: account.code,
      accountName: account.name,
      debit,
      credit,
      description: entry.description
    };

    this.entries.push(journalEntry);
    this.markDirty();
  }

  /**
   * Remove a journal entry
   */
  @action
  removeEntry(entryId: string): void {
    if (this.status !== TransactionStatus.DRAFT) {
      throw new Error('Cannot modify posted or voided transactions');
    }

    const index = this.entries.findIndex(e => e.id === entryId);
    if (index === -1) {
      throw new Error(`Entry not found: ${entryId}`);
    }

    this.entries.splice(index, 1);
    this.markDirty();
  }

  /**
   * Update a journal entry
   */
  @action
  async updateEntry(entryId: string, updates: {
    accountId?: string;
    debit?: number;
    credit?: number;
    description?: string;
  }): Promise<void> {
    if (this.status !== TransactionStatus.DRAFT) {
      throw new Error('Cannot modify posted or voided transactions');
    }

    const entry = this.entries.find(e => e.id === entryId);
    if (!entry) {
      throw new Error(`Entry not found: ${entryId}`);
    }

    // Update account if changed
    if (updates.accountId && updates.accountId !== entry.accountId) {
      const account = await Account.load(updates.accountId);
      if (!account) {
        throw new Error(`Account not found: ${updates.accountId}`);
      }

      if (!account.canPost()) {
        throw new Error(`Cannot post to inactive account: ${account.code} - ${account.name}`);
      }

      entry.accountId = updates.accountId;
      entry.accountCode = account.code;
      entry.accountName = account.name;
    }

    // Update amounts
    if (updates.debit !== undefined) {
      if (updates.debit < 0) {
        throw new Error('Debit amount must be positive');
      }
      entry.debit = updates.debit;
      entry.credit = 0; // Clear credit when setting debit
    }

    if (updates.credit !== undefined) {
      if (updates.credit < 0) {
        throw new Error('Credit amount must be positive');
      }
      entry.credit = updates.credit;
      entry.debit = 0; // Clear debit when setting credit
    }

    if (updates.description !== undefined) {
      entry.description = updates.description;
    }

    // Validate entry has amount
    if (entry.debit === 0 && entry.credit === 0) {
      throw new Error('Entry must have either a debit or credit amount');
    }

    this.markDirty();
  }

  /**
   * Business validation
   */
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.description || this.description.trim() === '') {
      errors.push('Transaction description is required');
    }

    if (this.entries.length < 2) {
      errors.push('Transaction must have at least two journal entries');
    }

    if (!this.isBalanced) {
      errors.push(`Transaction is not balanced. Difference: ${this.balanceDifference.toFixed(2)}`);
    }

    // Check for duplicate accounts (optional business rule)
    const accountIds = this.entries.map(e => e.accountId);
    const uniqueAccountIds = new Set(accountIds);
    if (accountIds.length !== uniqueAccountIds.size) {
      // This is just a warning, not an error - sometimes you need multiple entries to same account
      console.warn('Transaction has multiple entries to the same account');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Post the transaction (make it permanent)
   */
  @action
  async post(userId?: string): Promise<void> {
    if (this.status !== TransactionStatus.DRAFT) {
      throw new Error('Only draft transactions can be posted');
    }

    // Validate transaction
    const validation = this.validate();
    if (!validation.isValid) {
      throw new Error(`Cannot post invalid transaction: ${validation.errors.join(', ')}`);
    }

    // Update account balances
    for (const entry of this.entries) {
      const account = await Account.load(entry.accountId);
      if (account) {
        // Calculate balance impact based on normal balance
        let balanceChange = 0;
        if (account.normalBalance === 'debit') {
          balanceChange = entry.debit - entry.credit;
        } else {
          balanceChange = entry.credit - entry.debit;
        }
        
        account.updateBalance(balanceChange);
        await account.save();
      }
    }

    // Mark as posted
    this.status = TransactionStatus.POSTED;
    this.postedAt = new Date();
    this.postedBy = userId;

    await this.save();
  }

  /**
   * Void the transaction
   */
  @action
  async void(reason: string, userId?: string): Promise<void> {
    if (this.status !== TransactionStatus.POSTED) {
      throw new Error('Only posted transactions can be voided');
    }

    if (!reason || reason.trim() === '') {
      throw new Error('Void reason is required');
    }

    // Reverse account balance changes
    for (const entry of this.entries) {
      const account = await Account.load(entry.accountId);
      if (account) {
        // Reverse the balance change
        let balanceChange = 0;
        if (account.normalBalance === 'debit') {
          balanceChange = -(entry.debit - entry.credit);
        } else {
          balanceChange = -(entry.credit - entry.debit);
        }
        
        account.updateBalance(balanceChange);
        await account.save();
      }
    }

    // Mark as voided
    this.status = TransactionStatus.VOID;
    this.voidedAt = new Date();
    this.voidedBy = userId;
    this.voidReason = reason;

    await this.save();
  }

  /**
   * Factory method to create a simple two-entry transaction
   */
  static async createSimple(data: {
    date?: Date;
    description: string;
    reference?: string;
    debitAccountId: string;
    creditAccountId: string;
    amount: number;
    entryDescription?: string;
  }): Promise<Transaction> {
    if (data.amount <= 0) {
      throw new Error('Amount must be positive');
    }

    const id = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const transaction = new Transaction(id);
    
    transaction.update({
      date: data.date || new Date(),
      description: data.description,
      reference: data.reference
    });

    // Add debit entry
    await transaction.addEntry({
      accountId: data.debitAccountId,
      debit: data.amount,
      description: data.entryDescription
    });

    // Add credit entry
    await transaction.addEntry({
      accountId: data.creditAccountId,
      credit: data.amount,
      description: data.entryDescription
    });

    return transaction;
  }

  /**
   * Get transactions by status
   */
  static async getByStatus(status: TransactionStatus): Promise<Transaction[]> {
    const allTransactions = await Transaction.loadAll();
    return allTransactions.filter(txn => txn.status === status);
  }

  /**
   * Get draft transactions
   */
  static async getDrafts(): Promise<Transaction[]> {
    return Transaction.getByStatus(TransactionStatus.DRAFT);
  }

  /**
   * Get posted transactions
   */
  static async getPosted(): Promise<Transaction[]> {
    return Transaction.getByStatus(TransactionStatus.POSTED);
  }

  /**
   * Get transactions for date range
   */
  static async getForDateRange(startDate: Date, endDate: Date): Promise<Transaction[]> {
    const allTransactions = await Transaction.loadAll();
    return allTransactions.filter(txn => 
      txn.date >= startDate && 
      txn.date <= endDate &&
      txn.status === TransactionStatus.POSTED
    );
  }

  /**
   * Get transactions affecting a specific account
   */
  static async getForAccount(accountId: string): Promise<Transaction[]> {
    const allTransactions = await Transaction.loadAll();
    return allTransactions.filter(txn => 
      txn.entries.some((entry: JournalEntry) => entry.accountId === accountId) &&
      txn.status === TransactionStatus.POSTED
    );
  }
}