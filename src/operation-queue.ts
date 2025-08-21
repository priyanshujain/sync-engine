import { Operation } from "./operation";

export class OperationQueue {
    private pending: Operation[] = [];
    private isProcessing = false;
  
    enqueue(transaction: Operation) {
      this.pending.push(transaction);
      this.processQueue();
    }
  
    private async processQueue() {
      if (this.isProcessing) return;
      this.isProcessing = true;
      
      /*
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0, 10); // Batch size 10
        await this.sendToServer(batch);
      }
      */
      this.isProcessing = false;

    }
  
    /*
    private async sendToServer(batch: Operation[]) {
      try {
        const response = await fetch('/sync', {
          method: 'POST',
          body: JSON.stringify(batch)
        });
        
        if (!response.ok) throw new Error('Sync failed');
        await this.handleDeltaPackets(await response.json());
      } catch (error) {
        console.error('Sync error:', error);
        this.pending.unshift(...batch); // Retry failed batch
      }
    }
    */
  
    /*
    private async handleDeltaPackets(deltas: any[]) {
      // Handle server response
    }
    */
  }