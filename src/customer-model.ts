import { ClientModel, Property } from "./decorator";
import { BaseModel, ModelOptions } from "./models/base-model";
import { BackReference } from "./back-reference";
import { LazyReferenceCollection } from "./lazy-reference-collection";
import { Invoice } from "./invoice-model";
import { makeObservable } from "mobx";

@ClientModel('Customer')
export class Customer extends BaseModel {
    @Property({ type: 'property' })
    name!: string;

    @BackReference()
    invoices!: LazyReferenceCollection<Invoice>;

    constructor(id: string, options?: ModelOptions) {
        super(id, options);
        this.name = '';
        makeObservable(this);
    }

    initialize(name: string) {
        this.name = name;
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
            name: this.name
        };
    }
}
