import { ClientModel, Property } from "./decorator";
import { BaseModel, ModelOptions } from "./models/base-model";
import { Reference } from "./reference";
import { Customer } from "./customer-model";
import { makeObservable, observable } from "mobx";

@ClientModel('Invoice')
class Invoice extends BaseModel {
    @Property({ type: 'property' })
    amount!: number;

    @Property({ type: 'property' })
    status!: string;

    @observable @Reference(() => Customer, 'customer')
    customer!: Customer;

    constructor(id: string, options?: ModelOptions) {
        super(id, options);
        this.amount = 0;
        this.status = 'pending';
        makeObservable(this);
    }

    initialize(amount: number, status: string) {
        this.amount = amount;
        this.status = status;
        return this;
    }

    async save(): Promise<void> {
        // Mark as dirty to trigger save in base class
        this.markDirty();
        // Call parent save which handles transaction creation
        return super.save();
    }

    toJSON(): Record<string, any> {
        return {
            id: this.id,
            amount: this.amount,
            status: this.status,
            customerId: this.customer?.id
        };
    }
}
export { Invoice };
