# Memory Test Suite

This directory contains comprehensive memory leak detection and stress testing tools for the sync engine.

## Tests Available

### 1. Basic Memory Test
```bash
npm run test:memory:basic
```
- **Duration**: ~30 seconds
- **Purpose**: Quick validation of resource cleanup
- **Tests**: ResourceManager, Model lifecycle, Sync engine disposal
- **Pass Criteria**: < 5MB memory growth

### 2. Stress Test (Long-running)
```bash
npm run test:memory
```
- **Duration**: 2 minutes (configurable)
- **Purpose**: Detect memory leaks under continuous load
- **Activities**: Continuous model creation, modification, deletion
- **Pass Criteria**: No memory leak detection, stable resource usage

### 3. Memory Monitor
```bash
npm run monitor:memory
```
- **Duration**: Until stopped (Ctrl+C)
- **Purpose**: Monitor memory usage in real-time
- **Output**: Memory statistics every 2 seconds

## What These Tests Validate

### ✅ Resource Management Fixes
- Timer cleanup (setTimeout/setInterval)
- WebSocket connection lifecycle
- Event listener removal
- AbortController cleanup
- Model disposal

### ✅ Memory Leak Prevention
- No unbounded memory growth
- Proper garbage collection
- Resource disposal patterns
- Connection cleanup

### ✅ Stress Test Scenarios
- High-frequency model operations
- Concurrent modifications
- Resource churn (create/dispose cycles)
- Sync engine operations under load

## Expected Results

### Healthy System:
```
📊 Memory Growth: +0.17 MB
✅ PASS: Memory growth within acceptable limits
🎉 Basic Memory Test PASSED - No memory leaks detected!
```

### Memory Leak Detected:
```
⚠️ MEMORY LEAK DETECTED - Heap grew by more than 20MB
❌ FAIL: Memory growth exceeds 5MB threshold
💥 Basic Memory Test FAILED - Memory leaks detected!
```

## Understanding the Output

### Memory Metrics:
- **Heap Used**: Active memory usage
- **Heap Total**: Total heap allocated
- **External**: Memory used by C++ objects
- **RSS**: Resident Set Size (total process memory)

### Growth Thresholds:
- **Basic Test**: < 5MB acceptable
- **Stress Test**: No continuous growth pattern
- **Long-term**: Stable over time

### Key Indicators:
1. **Memory Growth**: Should be minimal and stable
2. **Resource Counts**: Should not grow unbounded
3. **Error Rate**: Should be < 1% of operations
4. **Cleanup Success**: All resources properly disposed

## Troubleshooting

### High Memory Growth:
1. Check for uncleaned timers
2. Look for undisposed event listeners
3. Verify model disposal calls
4. Check WebSocket cleanup

### Test Failures:
1. Verify all dependencies installed (`npm install`)
2. Check Node.js version (v16+ recommended)
3. Ensure sufficient system memory
4. Check for other memory-intensive processes

### Performance Issues:
1. Reduce test duration or intensity
2. Increase sleep intervals in stress test
3. Lower batch sizes for operations
4. Check system resource availability

## Integration with CI/CD

These tests can be integrated into continuous integration:

```yaml
# Example GitHub Actions
- name: Run Memory Tests
  run: |
    npm run test:memory:basic
    npm run test:memory
```

Memory test results help ensure:
- No regressions in resource management
- Stable memory usage patterns
- Production readiness validation
- Long-running application safety