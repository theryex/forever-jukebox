/**
 * Web Worker for maintaining setTimeout/setInterval when the browser tab is hidden.
 * 
 * When a tab loses focus, browsers throttle setTimeout to save resources.
 * This worker provides an alternative timing mechanism that continues
 * to fire even when the main thread's timers are throttled.
 */

const timeouts = new Map();
const intervals = new Map();

self.onmessage = function(event) {
    const { command, id, delay } = event.data;
    
    switch (command) {
        case 'setTimeout':
            const timeoutId = setTimeout(() => {
                self.postMessage({ type: 'timeout', id });
                timeouts.delete(id);
            }, delay);
            timeouts.set(id, timeoutId);
            break;
            
        case 'clearTimeout':
            if (timeouts.has(id)) {
                clearTimeout(timeouts.get(id));
                timeouts.delete(id);
            }
            break;
            
        case 'setInterval':
            const intervalId = setInterval(() => {
                self.postMessage({ type: 'interval', id });
            }, delay);
            intervals.set(id, intervalId);
            break;
            
        case 'clearInterval':
            if (intervals.has(id)) {
                clearInterval(intervals.get(id));
                intervals.delete(id);
            }
            break;
    }
};
