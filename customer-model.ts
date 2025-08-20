import { ClientModel, Property } from "./decorator";
import { Model } from "./model";
import { UpdateOperation } from "./operation";
import { BackReference } from "./back-reference";
import { LazyReferenceCollection } from "./lazy-reference-collection";
import { Invoice } from "./invoice-model";
import { makeObservable } from "mobx";

@ClientModel('Customer')
export class Customer extends Model {
    @Property({ type: 'property' })
    name!: string;

    @BackReference()
    invoices!: LazyReferenceCollection<Invoice>;

    constructor(id: string) {
        super(id);
        this.name = '';
        makeObservable(this);
    }

    initialize(name: string) {
        this.name = name;
        return this;
    }

    save() {
        const changes = this.getChanges();
        if (Object.keys(changes).length > 0) {
            const transaction = new UpdateOperation(
                this.id,
                'Customer',
                changes
            );
            this.markChanged();
            this.operationQueue.enqueue(transaction);
        }
    }

    protected getChanges(): Record<string, any> {
        return {
            name: this.name
        };
    }
}
