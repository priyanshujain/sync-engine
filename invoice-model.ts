import { ClientModel, Property } from "./decorator";
import { Model } from "./model";
import { UpdateOperation } from "./operation";
import { Reference } from "./reference";
import { Customer } from "./customer-model";
import { makeObservable, observable } from "mobx";

@ClientModel('Invoice')
class Invoice extends Model {
    @Property({ type: 'property' })
    amount!: number;

    @Property({ type: 'property' })
    status!: string;

    @observable @Reference(() => Customer, 'customer')
    customer!: Customer;

    constructor(id: string) {
        super(id);
        this.amount = 0;
        this.status = 'pending';
        makeObservable(this);
    }

    initialize(amount: number, status: string) {
        this.amount = amount;
        this.status = status;
        return this;
    }

    save() {
        const changes = this.getChanges();
        if (Object.keys(changes).length > 0) {
            const transaction = new UpdateOperation(
                this.id,
                'Invoice',
                changes
            );
            this.markChanged();
            this.operationQueue.enqueue(transaction);
        }
    }

    protected getChanges(): Record<string, any> {
        // TODO: Only return changes that have actually changed
        return {
            amount: this.amount,
            status: this.status,
            customerId: this.customer.id
        }
    }
}
export { Invoice };
