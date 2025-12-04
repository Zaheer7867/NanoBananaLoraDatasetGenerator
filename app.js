/**
 * NanoBanana Pro LoRA Dataset Generator - Static Version
 * Uses FAL's official client SDK for browser compatibility
 */

// Import FAL client from CDN (named export)
import { fal } from 'https://esm.sh/@fal-ai/client@1.2.1';

// =============================================================================
// State
// =============================================================================

const state = {
    isGenerating: false,
    pairs: [], // Store generated pairs in memory
    pairCounter: 0
};

// =============================================================================
// API Key Management
// =============================================================================

function getApiKey() {
    return localStorage.getItem('fal_api_key') || '';
}

function setApiKey(key) {
    if (key) {
        localStorage.setItem('fal_api_key', key);
        // Configure FAL client with the key
        fal.config({ credentials: key });
    } else {
        localStorage.removeItem('fal_api_key');
    }
}

function showApiKeyModal() {
    document.getElementById('apiKeyModal').classList.remove('hidden');
    const input = document.getElementById('apiKeyInput');
    input.value = getApiKey();
    input.focus();
}

function hideApiKeyModal() {
    document.getElementById('apiKeyModal').classList.add('hidden');
}

function toggleKeyVisibility() {
    const input = document.getElementById('apiKeyInput');
    const icon = document.getElementById('keyVisibilityIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = '🙈';
    } else {
        input.type = 'password';
        icon.textContent = '👁️';
    }
}

function saveApiKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) {
        alert('Please enter an API key');
        return;
    }
    setApiKey(key);
    hideApiKeyModal();
    updateStatus(true, 'API Key Saved');
}

function clearApiKey() {
    if (confirm('Clear your API key?')) {
        setApiKey('');
        document.getElementById('apiKeyInput').value = '';
        updateStatus(false, 'No API Key');
    }
}

// =============================================================================
// FAL API Calls using official SDK
// =============================================================================

async function falRequest(endpoint, input) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('Please add your FAL API key first');
    }
    
    // Ensure FAL is configured
    fal.config({ credentials: apiKey });
    
    try {
        // Use FAL's subscribe method which handles queuing
        // Returns { data, requestId } - we want data
        console.log(`FAL request to ${endpoint}:`, input);
        const result = await fal.subscribe(endpoint, { input });
        console.log(`FAL response from ${endpoint}:`, result);
        return result.data || result;
    } catch (error) {
        console.error(`FAL error for ${endpoint}:`, error);
        throw new Error(error.message || error.body?.detail || 'FAL API call failed');
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Image Generation
// =============================================================================

async function generateStartImage(prompt, aspectRatio, resolution) {
    const result = await falRequest('fal-ai/nano-banana-pro', {
        prompt: prompt,
        aspect_ratio: aspectRatio,
        resolution: resolution,  // "1K", "2K", or "4K"
        num_images: 1
    });
    
    return result.images[0].url;
}

async function generateEndImage(startImageUrl, editPrompt, aspectRatio, resolution) {
    const result = await falRequest('fal-ai/nano-banana-pro/edit', {
        image_urls: [startImageUrl],  // Must be array!
        prompt: editPrompt,
        aspect_ratio: 'auto',  // Edit uses 'auto' by default
        resolution: resolution
    });
    
    return result.images[0].url;
}

async function captionImage(imageUrl, model) {
    const result = await falRequest('openrouter/router/vision', {
        model: model,
        prompt: "Caption this image for a text-to-image model. Describe everything visible in detail: subject, appearance, clothing, pose, expression, background, lighting, colors, style. Be specific and comprehensive.",
        system_prompt: "Only answer the question, do not provide any additional information. Don't use markdown.",
        image_urls: [imageUrl],  // Must be array!
        temperature: 1.0
    });
    
    return result.output;
}

// =============================================================================
// LLM Prompt Generation
// =============================================================================

async function generatePromptsWithLLM(theme, transformation, actionName, numPrompts, model) {
    const actionHint = actionName 
        ? `Use this action name: "${actionName}"` 
        : 'Generate a short, descriptive action name (like "unzoom", "add_bg", "enhance")';
    
    const systemPrompt = `You are a creative prompt engineer for AI image generation. Generate diverse, detailed prompts for creating training data.

RULES:
1. Each prompt must be unique and creative
2. base_prompt: Detailed description for generating the START image
3. edit_prompt: Instruction for transforming START → END image
4. action_name: Short identifier for this transformation type

The transformation to learn: "${transformation}"
${actionHint}`;

    const userPrompt = `Generate ${numPrompts} unique prompt pairs for the theme: "${theme}"

Return ONLY valid JSON array:
[
  {
    "base_prompt": "detailed start image description...",
    "edit_prompt": "transformation instruction...",
    "action_name": "short_action"
  }
]`;

    const result = await falRequest('fal-ai/any-llm', {
        model: model,
        system_prompt: systemPrompt,
        prompt: userPrompt,
        max_tokens: 16000  // High limit for larger batches
    });
    
    // Parse JSON from response
    const text = result.output;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
        throw new Error('Failed to parse LLM response');
    }
    
    return JSON.parse(jsonMatch[0]);
}

// =============================================================================
// UI Functions
// =============================================================================

function updateStatus(connected, message) {
    document.getElementById('statusDot').className = 'status-dot ' + (connected ? 'connected' : 'error');
    document.getElementById('statusText').textContent = message;
}

function updatePairCount() {
    document.getElementById('pairCount').textContent = state.pairs.length;
}

function getImageCost() {
    const resolution = document.getElementById('resolution').value;
    return resolution === '4K' ? 0.30 : 0.15;
}

function updateCostEstimate() {
    const numPairs = parseInt(document.getElementById('numPairs').value) || 20;
    const useVision = document.getElementById('useVisionCaption').checked;
    const resolution = document.getElementById('resolution').value;
    
    const imagesPerPair = 2; // 1 start + 1 end
    const imageCost = getImageCost();
    const baseCost = numPairs * imagesPerPair * imageCost;
    const visionCost = useVision ? numPairs * imagesPerPair * 0.002 : 0;
    const llmCost = 0.02;
    const total = baseCost + visionCost + llmCost;
    
    const resLabel = resolution === '4K' ? ' @4K' : '';
    document.getElementById('costEstimate').textContent = `~$${total.toFixed(2)}${resLabel}`;
}

function showLoading(show, message = 'Generating...') {
    state.isGenerating = show;
    const loader = document.getElementById('loadingIndicator');
    loader.classList.toggle('hidden', !show);
    loader.querySelector('span').textContent = message;
}

function showProgress(show) {
    document.getElementById('progressPanel').classList.toggle('hidden', !show);
}

function updateProgress(current, total, status) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    document.getElementById('progressFill').style.width = `${percent}%`;
    document.getElementById('progressCurrent').textContent = current;
    document.getElementById('progressTotal').textContent = total;
    document.getElementById('progressStatus').textContent = status;
}

function addProgressLog(message, type = 'info') {
    const log = document.getElementById('progressLog');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = message;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function clearProgressLog() {
    document.getElementById('progressLog').innerHTML = '';
}

function addResultCard(pair) {
    const container = document.getElementById('results');
    const card = document.createElement('div');
    card.className = 'result-card';
    
    card.innerHTML = `
        <div class="result-header">
            <span class="result-id">#${pair.id}</span>
        </div>
        <div class="result-images">
            <div class="result-image">
                <span class="label">START</span>
                <img src="${pair.startUrl}" alt="Start" loading="lazy">
            </div>
            <div class="result-image">
                <span class="label">END</span>
                <img src="${pair.endUrl}" alt="End" loading="lazy">
            </div>
        </div>
    `;
    
    container.insertBefore(card, container.firstChild);
}

function truncate(str, length) {
    if (!str) return '';
    return str.length > length ? str.substring(0, length) + '...' : str;
}

// =============================================================================
// Main Generation Function
// =============================================================================

// Generate a single pair (used for parallel execution)
async function generateSinglePair(prompt, index, total, aspectRatio, resolution, useVision, llmModel, triggerWord) {
    addProgressLog(`🎨 [${index + 1}/${total}] Starting: ${truncate(prompt.base_prompt, 35)}...`, 'info');
    
    try {
        // Generate START image
        addProgressLog(`   [${index + 1}] Generating START image...`, 'info');
        const startUrl = await generateStartImage(prompt.base_prompt, aspectRatio, resolution);
        addProgressLog(`   [${index + 1}] START done, generating END...`, 'info');
        
        // Generate END image
        const endUrl = await generateEndImage(startUrl, prompt.edit_prompt, aspectRatio, resolution);
        addProgressLog(`   [${index + 1}] END done!`, 'info');
        
        // Optional: Caption with vision
        let finalText = prompt.action_name;
        if (useVision) {
            try {
                const caption = await captionImage(endUrl, llmModel);
                finalText = caption;
            } catch (e) {
                console.warn('Vision caption failed:', e);
            }
        }
        
        // Add trigger word if specified
        if (triggerWord) {
            finalText = `${triggerWord} ${finalText}`;
        }
        
        return {
            startUrl,
            endUrl,
            startPrompt: prompt.base_prompt,
            endPrompt: prompt.edit_prompt,
            actionName: prompt.action_name,
            text: finalText
        };
    } catch (error) {
        console.error(`Pair ${index + 1} error:`, error);
        throw new Error(error.message || error.toString() || 'Generation failed');
    }
}

async function startGeneration() {
    const theme = document.getElementById('theme').value.trim();
    const transformation = document.getElementById('transformation').value.trim();
    const actionName = document.getElementById('actionName').value.trim();
    const triggerWord = document.getElementById('triggerWord').value.trim();
    const numPairs = Math.min(100, parseInt(document.getElementById('numPairs').value) || 20); // Cap at 100
    const maxConcurrent = parseInt(document.getElementById('maxConcurrent')?.value) || 3;
    const aspectRatio = document.getElementById('aspectRatio').value;
    const resolution = document.getElementById('resolution').value;
    const useVision = document.getElementById('useVisionCaption').checked;
    const llmModel = document.getElementById('llmModel').value;
    
    if (!theme || !transformation) {
        alert('Please fill in theme and transformation');
        return;
    }
    
    if (!getApiKey()) {
        showApiKeyModal();
        return;
    }
    
    // Confirm
    const cost = (numPairs * 2 * getImageCost() + 0.02).toFixed(2);
    if (!confirm(`Generate ${numPairs} pairs?\n\n⚡ ${maxConcurrent} parallel requests\n💰 Estimated cost: ~$${cost}\n\nImages stored in memory.\nUse "Download ZIP" to save.`)) {
        return;
    }
    
    showProgress(true);
    clearProgressLog();
    updateProgress(0, numPairs, 'Generating prompts with AI...');
    addProgressLog('🤖 Generating creative prompts...', 'info');
    
    state.isGenerating = true;
    let completed = 0;
    let failed = 0;
    
    try {
        // Generate prompts
        const prompts = await generatePromptsWithLLM(theme, transformation, actionName, numPairs, llmModel);
        addProgressLog(`✅ Generated ${prompts.length} unique prompts`, 'success');
        addProgressLog(`⚡ Starting parallel generation (${maxConcurrent} at a time)...`, 'info');
        
        // Process in batches of maxConcurrent
        for (let i = 0; i < prompts.length; i += maxConcurrent) {
            if (!state.isGenerating) break;
            
            const batch = prompts.slice(i, Math.min(i + maxConcurrent, prompts.length));
            
            // Run batch in parallel
            const results = await Promise.allSettled(
                batch.map((p, batchIndex) => 
                    generateSinglePair(p, i + batchIndex, prompts.length, aspectRatio, resolution, useVision, llmModel, triggerWord)
                )
            );
            
            // Process results
            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                if (result.status === 'fulfilled') {
                    state.pairCounter++;
                    const pair = {
                        id: String(state.pairCounter).padStart(4, '0'),
                        ...result.value
                    };
                    state.pairs.push(pair);
                    addResultCard(pair);
                    updatePairCount();
                    completed++;
                    addProgressLog(`✅ Pair #${pair.id} complete`, 'success');
                } else {
                    failed++;
                    addProgressLog(`❌ Pair ${i + j + 1} failed: ${result.reason?.message || 'Unknown error'}`, 'error');
                }
                updateProgress(completed + failed, prompts.length, `${completed}/${prompts.length} done`);
            }
        }
        
        const failInfo = failed > 0 ? ` (${failed} failed)` : '';
        updateProgress(prompts.length, prompts.length, 'Complete!');
        addProgressLog(`🎉 Done! ${completed} pairs generated${failInfo}`, 'success');
        addProgressLog(`📥 Click "Download ZIP" to save your dataset`, 'info');
        
    } catch (error) {
        addProgressLog(`❌ Error: ${error.message}`, 'error');
        alert('Error: ' + error.message);
    } finally {
        state.isGenerating = false;
    }
}

function stopGeneration() {
    state.isGenerating = false;
    addProgressLog('⏹️ Stopped by user', 'info');
}

// =============================================================================
// ZIP Download
// =============================================================================

async function downloadZIP() {
    if (state.pairs.length === 0) {
        alert('No pairs to download! Generate some first.');
        return;
    }
    
    showLoading(true, 'Creating ZIP...');
    
    try {
        // Dynamic import JSZip
        const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
        const zip = new JSZip();
        
        // Download and add each pair
        for (let i = 0; i < state.pairs.length; i++) {
            const pair = state.pairs[i];
            
            // Fetch images as blobs
            const startBlob = await fetch(pair.startUrl).then(r => r.blob());
            const endBlob = await fetch(pair.endUrl).then(r => r.blob());
            
            // Add to ZIP
            zip.file(`${pair.id}_start.png`, startBlob);
            zip.file(`${pair.id}_end.png`, endBlob);
            zip.file(`${pair.id}.txt`, pair.text);
        }
        
        // Generate and download
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nanobanana_dataset_${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        
    } catch (error) {
        alert('Error creating ZIP: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function clearResults() {
    if (state.pairs.length === 0) return;
    if (!confirm(`Clear all ${state.pairs.length} pairs from memory?`)) return;
    
    state.pairs = [];
    state.pairCounter = 0;
    document.getElementById('results').innerHTML = '';
    updatePairCount();
}

// =============================================================================
// Initialization
// =============================================================================

function init() {
    // Check for API key and configure FAL
    const apiKey = getApiKey();
    if (apiKey) {
        fal.config({ credentials: apiKey });
        updateStatus(true, 'API Key Set');
    } else {
        updateStatus(false, 'Click 🔑 to add API key');
        setTimeout(() => showApiKeyModal(), 500);
    }
    
    // Setup cost estimate
    document.getElementById('numPairs').addEventListener('input', updateCostEstimate);
    document.getElementById('useVisionCaption').addEventListener('change', updateCostEstimate);
    document.getElementById('resolution').addEventListener('change', updateCostEstimate);
    updateCostEstimate();
    
    updatePairCount();
}

// Export to global scope for onclick handlers
window.showApiKeyModal = showApiKeyModal;
window.hideApiKeyModal = hideApiKeyModal;
window.toggleKeyVisibility = toggleKeyVisibility;
window.saveApiKey = saveApiKey;
window.clearApiKey = clearApiKey;
window.startGeneration = startGeneration;
window.stopGeneration = stopGeneration;
window.downloadZIP = downloadZIP;
window.clearResults = clearResults;

document.addEventListener('DOMContentLoaded', init);

