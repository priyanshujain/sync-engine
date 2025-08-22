import { IndexedBaseModel } from '../../../src/models/indexed-base-model';
import { observable, action } from 'mobx';

export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability', 
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense'
}

export type NormalBalance = 'debit' | 'credit';

/**
 * Account model for the General Ledger
 * Represents a chart of accounts entry
 */
export class Account extends IndexedBaseModel {
  @observable code: string = '';
  @observable name: string = '';
  @observable type: AccountType = AccountType.ASSET;
  @observable normalBalance: NormalBalance = 'debit';
  @observable parentId?: string;
  @observable isActive: boolean = true;
  @observable balance: number = 0; // Running balance cache
  @observable description?: string;

  constructor(id: string) {
    super(id, {
      autoSave: true,
      trackChanges: true,
      optimisticUpdate: true
    });
    
    // Set normal balance based on account type
    this.setNormalBalanceFromType();
  }

  /**
   * Set account properties and mark dirty
   */
  @action
  update(data: {
    code?: string;
    name?: string;
    type?: AccountType;
    parentId?: string;
    isActive?: boolean;
    description?: string;
  }): void {
    if (data.code !== undefined) this.code = data.code;
    if (data.name !== undefined) this.name = data.name;
    if (data.type !== undefined) {
      this.type = data.type;
      this.setNormalBalanceFromType();
    }
    if (data.parentId !== undefined) this.parentId = data.parentId;
    if (data.isActive !== undefined) this.isActive = data.isActive;
    if (data.description !== undefined) this.description = data.description;
    
    this.markDirty();
  }

  /**
   * Set normal balance based on account type
   */
  @action
  private setNormalBalanceFromType(): void {
    switch (this.type) {
      case AccountType.ASSET:
      case AccountType.EXPENSE:
        this.normalBalance = 'debit';
        break;
      case AccountType.LIABILITY:
      case AccountType.EQUITY:
      case AccountType.REVENUE:
        this.normalBalance = 'credit';
        break;
    }
  }

  /**
   * Update the running balance (called by transaction processing)
   */
  @action
  updateBalance(amount: number): void {
    this.balance += amount;
    this.markDirty();
  }

  /**
   * Deactivate account
   */
  @action
  deactivate(): void {
    this.isActive = false;
    this.markDirty();
  }

  /**
   * Reactivate account
   */
  @action
  activate(): void {
    this.isActive = true;
    this.markDirty();
  }

  /**
   * Get full account path (for hierarchical accounts)
   */
  async getFullPath(): Promise<string> {
    if (!this.parentId) {
      return `${this.code} - ${this.name}`;
    }
    
    const parent = await Account.load(this.parentId);
    if (parent) {
      const parentPath = await parent.getFullPath();
      return `${parentPath} > ${this.code} - ${this.name}`;
    }
    
    return `${this.code} - ${this.name}`;
  }

  /**
   * Business validation rules
   */
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.code || this.code.trim() === '') {
      errors.push('Account code is required');
    }

    if (!this.name || this.name.trim() === '') {
      errors.push('Account name is required');
    }

    // Code format validation (basic)
    if (this.code && !/^[A-Z0-9\-_]+$/i.test(this.code)) {
      errors.push('Account code can only contain letters, numbers, hyphens, and underscores');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if this account can be posted to
   */
  canPost(): boolean {
    return this.isActive;
  }

  /**
   * Factory method to create a new account
   */
  static async create(data: {
    code: string;
    name: string;
    type: AccountType;
    parentId?: string;
    description?: string;
  }): Promise<Account> {
    // Generate ID based on code (or use UUID)
    const id = `account_${data.code.toLowerCase()}`;
    
    // Check if account with this code already exists
    const existing = await Account.findOneBy({ code: data.code });
    if (existing) {
      throw new Error(`Account with code '${data.code}' already exists`);
    }
    
    const account = new Account(id);
    account.update(data);
    
    await account.save();
    return account;
  }

  /**
   * Find account by code
   */
  static async findByCode(code: string): Promise<Account | null> {
    return Account.findOneBy({ code });
  }

  /**
   * Get all active accounts
   */
  static async getActiveAccounts(): Promise<Account[]> {
    return Account.findBy({ isActive: true });
  }

  /**
   * Get accounts by type
   */
  static async getAccountsByType(type: AccountType): Promise<Account[]> {
    const allAccounts = await Account.loadAll();
    return allAccounts.filter(account => account.type === type && account.isActive);
  }

  /**
   * Get asset accounts
   */
  static async getAssets(): Promise<Account[]> {
    return Account.getAccountsByType(AccountType.ASSET);
  }

  /**
   * Get liability accounts
   */
  static async getLiabilities(): Promise<Account[]> {
    return Account.getAccountsByType(AccountType.LIABILITY);
  }

  /**
   * Get equity accounts
   */
  static async getEquity(): Promise<Account[]> {
    return Account.getAccountsByType(AccountType.EQUITY);
  }

  /**
   * Get revenue accounts
   */
  static async getRevenue(): Promise<Account[]> {
    return Account.getAccountsByType(AccountType.REVENUE);
  }

  /**
   * Get expense accounts
   */
  static async getExpenses(): Promise<Account[]> {
    return Account.getAccountsByType(AccountType.EXPENSE);
  }
}