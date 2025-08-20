import { Invoice } from "./invoice-model";
import { StoreManager } from "./store-manager";
import { Database } from "./database";
import { Customer } from "./customer-model";

async function main() {
    const database = new Database();
    await database.initialize();

    const customer = new Customer("1");
    customer.initialize("John Doe");
    customer.save();

    const invoice = new Invoice("1");
    invoice.initialize(100, "pending");
    invoice.customer = customer;
    invoice.save();

    console.log(invoice.customer);

    // await database.commit();
    // await database.rollback();
    // console.log(database.getStore("Invoice"));

    const storeManager = new StoreManager();
    await storeManager.initialize();
    // console.log(storeManager.getStore("Invoice"));
    // console.log(storeManager.getStore("Customer"));

    // Test lazy loading
    const invoices = await invoice.customer.invoices.load();
    console.log(invoices);
}

main().catch(console.error);

