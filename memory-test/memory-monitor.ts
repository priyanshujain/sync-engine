#!/usr/bin/env tsx

/**
 * Simple memory monitor to track memory usage over time
 * Can be used alongside the stress test to monitor external processes
 */

class SimpleMemoryMonitor {
  private interval: NodeJS.Timeout | null = null;
  private samples: Array<{
    timestamp: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  }> = [];

  start(intervalMs: number = 1000) {
    console.log('🔍 Starting memory monitor...');
    console.log('Time(s)\t\tHeap Used\tHeap Total\tExternal\tRSS');
    console.log('═══════════════════════════════════════════════════════════════');

    const startTime = Date.now();

    this.interval = setInterval(() => {
      if (typeof process !== 'undefined' && process.memoryUsage) {
        const usage = process.memoryUsage();
        const timestamp = Date.now();
        const elapsed = Math.floor((timestamp - startTime) / 1000);

        const sample = {
          timestamp,
          heapUsed: usage.heapUsed,
          heapTotal: usage.heapTotal,
          external: usage.external,
          rss: usage.rss
        };

        this.samples.push(sample);

        // Format and display
        const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(1);
        const heapTotalMB = (usage.heapTotal / 1024 / 1024).toFixed(1);
        const externalMB = (usage.external / 1024 / 1024).toFixed(1);
        const rssMB = (usage.rss / 1024 / 1024).toFixed(1);

        console.log(`${elapsed}s\t\t${heapUsedMB}MB\t\t${heapTotalMB}MB\t\t${externalMB}MB\t\t${rssMB}MB`);

        // Check for concerning growth
        if (this.samples.length > 10) {
          const recent = this.samples.slice(-10);
          const oldestRecent = recent[0];
          const growth = sample.heapUsed - oldestRecent.heapUsed;
          const growthMB = growth / 1024 / 1024;

          if (growthMB > 10) { // More than 10MB growth in 10 samples
            console.warn(`⚠️  Significant memory growth detected: +${growthMB.toFixed(1)}MB in last 10 samples`);
          }
        }
      }
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    console.log('\n📊 Memory Monitor Summary:');
    console.log('═══════════════════════════════════════');

    if (this.samples.length > 0) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      const duration = (last.timestamp - first.timestamp) / 1000;

      const heapGrowth = (last.heapUsed - first.heapUsed) / 1024 / 1024;
      const totalGrowth = (last.heapTotal - first.heapTotal) / 1024 / 1024;
      const rssGrowth = (last.rss - first.rss) / 1024 / 1024;

      console.log(`Duration: ${duration.toFixed(1)}s`);
      console.log(`Samples: ${this.samples.length}`);
      console.log(`Heap Growth: ${heapGrowth > 0 ? '+' : ''}${heapGrowth.toFixed(1)}MB`);
      console.log(`Total Heap Growth: ${totalGrowth > 0 ? '+' : ''}${totalGrowth.toFixed(1)}MB`);
      console.log(`RSS Growth: ${rssGrowth > 0 ? '+' : ''}${rssGrowth.toFixed(1)}MB`);

      // Memory leak detection
      if (heapGrowth > 20) {
        console.log('❌ POTENTIAL MEMORY LEAK: Heap grew by more than 20MB');
      } else if (heapGrowth > 10) {
        console.log('⚠️  WARNING: Significant heap growth detected');
      } else {
        console.log('✅ Memory usage appears stable');
      }
    }

    console.log('═══════════════════════════════════════\n');
  }
}

// CLI usage
const monitor = new SimpleMemoryMonitor();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nStopping memory monitor...');
  monitor.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nStopping memory monitor...');
  monitor.stop();
  process.exit(0);
});

// Start monitoring
monitor.start(2000); // Sample every 2 seconds

console.log('Memory monitor started. Press Ctrl+C to stop.\n');