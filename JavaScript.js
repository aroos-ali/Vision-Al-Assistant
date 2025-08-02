// This is the JavaScript file for the VISION AI assistant.
// It handles all the application logic, including state management,
// API calls, and DOM manipulation.

document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    const state = {
        chatHistory: [],
        searchQuery: '',
        inputValue: '',
        isLoading: false,
        isListening: false,
        uploadedImage: null
    };

    // --- DOM Element References ---
    const elements = {
        chatHistoryDiv: document.getElementById('chat-history'),
        searchInput: document.getElementById('search-input'),
        messageInput: document.getElementById('message-input'),
        chatForm: document.getElementById('chat-form'),
        sendButton: document.getElementById('send-button'),
        micButton: document.getElementById('mic-button'),
        imageUploadBtn: document.getElementById('image-upload-btn'),
        imageUploadInput: document.getElementById('image-upload'),
        imagePreviewDiv: document.getElementById('image-preview'),
        imagePreviewImg: document.getElementById('image-preview-img'),
        imagePreviewCloseBtn: document.getElementById('image-preview-close-btn'),
        summarizeChatBtn: document.getElementById('summarize-chat-btn'),
        canvas: document.getElementById('three-canvas')
    };

    // --- Global References for API & 3D Scene ---
    const refs = {
        recognition: null,
        audioContext: new (window.AudioContext || window.webkitAudioContext)(),
        audioSource: null,
        three: {
            scene: null,
            camera: null,
            renderer: null,
            core: null,
            animateFrameId: null
        }
    };

    // --- Utility Functions ---

    /**
     * Converts a File object to a Base64 string.
     * @param {File} file - The file to convert.
     * @returns {Promise<string>} - A promise that resolves with the base64 string.
     */
    const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
        });
    };

    /**
     * Converts a Base64 string to an ArrayBuffer.
     * @param {string} base64 - The base64 string.
     * @returns {ArrayBuffer} - The resulting ArrayBuffer.
     */
    const base64ToArrayBuffer = (base64) => {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    };

    /**
     * Converts raw PCM audio data to a WAV Blob.
     * @param {Int16Array} pcmData - The PCM audio data.
     * @param {number} sampleRate - The audio sample rate.
     * @returns {Blob} - A Blob containing the WAV audio data.
     */
    const pcmToWav = (pcmData, sampleRate) => {
        const dataLength = pcmData.byteLength;
        const buffer = new ArrayBuffer(44 + dataLength);
        const view = new DataView(buffer);

        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        const pcmView = new Int16Array(buffer, 44);
        for (let i = 0; i < pcmData.length; i++) {
            pcmView[i] = pcmData[i];
        }

        return new Blob([view], { type: 'audio/wav' });
    };

    /**
     * Scrolls the chat history to the bottom.
     */
    const scrollToBottom = () => {
        elements.chatHistoryDiv.scrollTop = elements.chatHistoryDiv.scrollHeight;
    };

    /**
     * Highlights a search query within a text string.
     * @param {string} text - The text to search within.
     * @returns {string} - The text with the search query highlighted.
     */
    const highlightText = (text) => {
        if (!state.searchQuery) return text;
        const regex = new RegExp(`(${state.searchQuery})`, 'gi');
        return text.split(regex).map((part) => {
            if (part.toLowerCase() === state.searchQuery.toLowerCase()) {
                return `<span class="bg-yellow-500 text-black rounded-sm px-1 font-bold">${part}</span>`;
            }
            return part;
        }).join('');
    };

    /**
     * Renders a message's content, handling markdown code blocks and highlighting.
     * @param {string} text - The message text.
     * @returns {string} - The HTML string for the message content.
     */
    const renderMessageContent = (text) => {
        const parts = text.split(/(```[\s\S]*?```)/g);
        return parts.map((part) => {
            if (part.startsWith('```') && part.endsWith('```')) {
                const [lang, ...codeLines] = part.substring(3, part.length - 3).split('\n');
                const code = codeLines.join('\n');
                return `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
            }
            const highlightedText = highlightText(part);
            const p = document.createElement('p');
            p.innerHTML = highlightedText;
            return p.outerHTML;
        }).join('');
    };

    /**
     * Renders the entire chat history to the DOM.
     */
    const renderChatHistory = () => {
        const filteredHistory = state.chatHistory.filter(msg =>
            msg.text.toLowerCase().includes(state.searchQuery.toLowerCase())
        );

        elements.chatHistoryDiv.innerHTML = '';
        if (filteredHistory.length === 0 && state.chatHistory.length === 0) {
            elements.chatHistoryDiv.innerHTML = '<div class="welcome-message"><p>Welcome. I am VISION. Ask me anything.</p></div>';
            return;
        }

        filteredHistory.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${msg.role}`;
            const bubbleDiv = document.createElement('div');
            bubbleDiv.className = `chat-bubble ${msg.role}`;

            const username = document.createElement('p');
            username.className = 'username';
            username.textContent = msg.role === 'user' ? 'You' : 'VISION';
            bubbleDiv.appendChild(username);

            bubbleDiv.innerHTML += renderMessageContent(msg.text);

            if (msg.imageUrl) {
                const img = document.createElement('img');
                img.src = msg.imageUrl;
                img.alt = msg.role === 'user' ? 'User-uploaded image' : 'Generated by VISION';
                img.className = 'mt-2 rounded-xl w-full h-auto';
                bubbleDiv.appendChild(img);
            }

            messageDiv.appendChild(bubbleDiv);
            elements.chatHistoryDiv.appendChild(messageDiv);
        });
        scrollToBottom();
    };

    /**
     * Updates the UI based on the current application state.
     */
    const updateUI = () => {
        const isDisabled = state.isLoading || (!state.inputValue.trim() && !state.uploadedImage);
        elements.messageInput.disabled = state.isLoading;
        elements.sendButton.disabled = isDisabled;
        elements.imageUploadBtn.disabled = state.isLoading;
        elements.micButton.disabled = state.isLoading;
        elements.summarizeChatBtn.disabled = state.isLoading || state.chatHistory.length === 0;

        const placeholder = state.isListening ? "Listening..." : state.isLoading ? "Processing request..." : state.uploadedImage ? "Type a prompt for the image, or send directly..." : "Ask me anything...";
        elements.messageInput.placeholder = placeholder;

        if (state.isListening) {
            elements.micButton.classList.add('listening');
            elements.micButton.classList.remove('default');
        } else {
            elements.micButton.classList.remove('listening');
            elements.micButton.classList.add('default');
        }

        if (state.uploadedImage) {
            elements.imagePreviewDiv.style.display = 'flex';
            elements.imagePreviewImg.src = state.uploadedImage.dataUrl;
        } else {
            elements.imagePreviewDiv.style.display = 'none';
        }

        renderChatHistory();
    };

    /**
     * Fetches and plays audio from the Gemini TTS API.
     * @param {string} text - The text to be spoken.
     */
    const fetchAndPlayGeminiTTS = async (text) => {
        const payload = {
            contents: [{ parts: [{ text: text }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
                }
            }
        };
        try {
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            const part = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (audioData && mimeType && mimeType.startsWith("audio/")) {
                const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
                const pcmData = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                const audioUrl = URL.createObjectURL(wavBlob);
                const audio = new Audio(audioUrl);
                audio.play();
            } else {
                console.error("Gemini TTS API response missing audio data.");
            }
        } catch (error) {
            console.error("Error calling Gemini TTS API:", error);
        }
    };

    // --- Core Logic ---

    /**
     * Initializes the Three.js scene for the animated core.
     */
    const useThreeScene = () => {
        const canvas = elements.canvas;
        const three = refs.three;

        three.scene = new THREE.Scene();
        three.camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
        three.renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
        three.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        const geometry = new THREE.IcosahedronGeometry(1.2, 1);
        const material = new THREE.MeshPhongMaterial({
            color: 0x4B0082,
            emissive: 0x8A2BE2,
            specular: 0x9370DB,
            shininess: 30,
            flatShading: false
        });
        three.core = new THREE.Mesh(geometry, material);
        three.scene.add(three.core);

        const ambientLight = new THREE.AmbientLight(0x404040, 1);
        const pointLight = new THREE.PointLight(0xffffff, 1);
        pointLight.position.set(5, 5, 5);
        three.scene.add(ambientLight);
        three.scene.add(pointLight);

        three.camera.position.z = 3;

        const animate = () => {
            three.animateFrameId = requestAnimationFrame(animate);

            if (state.isListening) {
                three.core.rotation.x += 0.05;
                three.core.rotation.y += 0.05;
                material.emissiveIntensity = 2;
            } else if (state.isLoading) {
                three.core.rotation.x += 0.02;
                three.core.rotation.y += 0.02;
                material.emissiveIntensity = 1.5;
            } else {
                three.core.rotation.x += 0.005;
                three.core.rotation.y += 0.005;
                material.emissiveIntensity = 1;
            }

            three.renderer.render(three.scene, three.camera);
        };

        const handleResize = () => {
            three.camera.aspect = canvas.clientWidth / canvas.clientHeight;
            three.camera.updateProjectionMatrix();
            three.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        };

        window.addEventListener('resize', handleResize);
        animate();
    };

    /**
     * Toggles speech recognition on and off.
     */
    const handleVoiceToggle = () => {
        if (refs.recognition) {
            if (state.isListening) {
                refs.recognition.stop();
            } else {
                refs.recognition.start();
            }
        }
    };

    /**
     * Handles the summarization of the chat history via the Gemini API.
     */
    const handleSummarizeChat = async () => {
        if (state.chatHistory.length === 0) {
            alert("No messages to summarize!");
            return;
        }
        state.isLoading = true;
        updateUI();
        const chatText = state.chatHistory.map(msg => `${msg.role === 'user' ? 'User' : 'VISION'}: ${msg.text}`).join('\n');
        const prompt = `Please provide a concise summary of the following conversation:\n\n${chatText}\n\nSummary:`;

        let retryCount = 0;
        const maxRetries = 3;
        const baseDelay = 1000;

        const chatHistoryPayload = [{ role: "user", parts: [{ text: prompt }] }];
        const payload = { contents: chatHistoryPayload };
        const apiKey = "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

        while (retryCount < maxRetries) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) {
                    throw new Error(`API error: ${response.status} ${response.statusText}`);
                }
                const result = await response.json();
                const summaryText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (summaryText) {
                    state.chatHistory.push({ role: "vision", text: `Here is a summary of our conversation:\n\n${summaryText}` });
                    fetchAndPlayGeminiTTS("Here is a summary of our conversation.");
                } else {
                    const errorMessage = "Sorry, I couldn't summarize the conversation.";
                    state.chatHistory.push({ role: "vision", text: errorMessage });
                    fetchAndPlayGeminiTTS(errorMessage);
                }
                break;
            } catch (error) {
                console.error('Summarization API call failed:', error);
                retryCount++;
                if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    await new Promise(res => setTimeout(res, delay));
                } else {
                    const errorMessage = "I'm sorry, I am currently unable to summarize the conversation. Please try again later.";
                    state.chatHistory.push({ role: "vision", text: errorMessage });
                    fetchAndPlayGeminiTTS(errorMessage);
                }
            } finally {
                state.isLoading = false;
                updateUI();
            }
        }
    };

    /**
     * Sends a message to the Gemini API and handles the response.
     * @param {string} message - The user's message.
     */
    const sendMessage = async (message) => {
        if (!message.trim() && !state.uploadedImage) return;

        refs.audioContext.suspend();

        state.chatHistory.push({ role: "user", text: message, imageUrl: state.uploadedImage?.dataUrl });
        state.inputValue = '';
        elements.messageInput.value = '';
        state.isLoading = true;
        updateUI();

        const imagePromptPrefix = "generate an image of";
        let retryCount = 0;
        const maxRetries = 3;
        const baseDelay = 1000;

        if (state.uploadedImage) {
            state.chatHistory.push({ role: "vision", text: `Analyzing the image provided...` });
            updateUI();
            const base64Data = await fileToBase64(state.uploadedImage.file);
            const mimeType = state.uploadedImage.file.type;
            state.uploadedImage = null;

            const userPrompt = message.trim() || "What is in this image?";
            const chatHistoryPayload = {
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: userPrompt },
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Data
                                }
                            }
                        ]
                    }
                ]
            };

            while (retryCount < maxRetries) {
                try {
                    const apiKey = "";
                    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(chatHistoryPayload)
                    });
                    const result = await response.json();
                    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;

                    if (text) {
                        state.chatHistory.push({ role: "vision", text: text });
                        fetchAndPlayGeminiTTS(text);
                    } else {
                        const errorMessage = "Sorry, I couldn't analyze the image. The API returned an unexpected format.";
                        state.chatHistory.push({ role: "vision", text: errorMessage });
                        fetchAndPlayGeminiTTS(errorMessage);
                    }
                    break;
                } catch (error) {
                    console.error('Image analysis API call failed:', error);
                    retryCount++;
                    if (retryCount < maxRetries) {
                        const delay = baseDelay * Math.pow(2, retryCount);
                        await new Promise(res => setTimeout(res, delay));
                    } else {
                        const errorMessage = "I am unable to analyze the image at this time. Please try again later.";
                        state.chatHistory.push({ role: "vision", text: errorMessage });
                        fetchAndPlayGeminiTTS(errorMessage);
                    }
                } finally {
                    state.isLoading = false;
                    updateUI();
                }
            }
        } else if (message.toLowerCase().startsWith(imagePromptPrefix)) {
            const imagePrompt = message.substring(imagePromptPrefix.length).trim();
            state.chatHistory.push({ role: "vision", text: `Generating an image of: "${imagePrompt}"...` });
            updateUI();
