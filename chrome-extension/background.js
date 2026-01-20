// Background service worker para CompraAgil Extension
// Maneja la comunicación y notificaciones

const SUPABASE_URL = 'https://juiskeeutbaipwbeeezw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1aXNrZWV1dGJhaXB3YmVlZXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0MTk2NTYsImV4cCI6MjA1MDk5NTY1Nn0.EwCkMvbGWChwM95RZwlNr7tHvl2TxZCbKe3Flx17KFI';

// Estado de la extensión
let extensionState = {
  isActive: true,
  lastSync: null,
  totalSynced: 0
};

// Escuchar instalación
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[CompraAgil] Extension instalada:', details.reason);
  
  // Configuración inicial
  chrome.storage.local.set({
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_ANON_KEY,
    isActive: true,
    syncedCount: 0
  });
});

// Escuchar mensajes del content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[CompraAgil Background] Mensaje recibido:', message.type);
  
  switch (message.type) {
    case 'SYNC_COMPLETE':
      extensionState.lastSync = new Date().toISOString();
      extensionState.totalSynced += message.count || 0;
      
      // Actualizar badge
      chrome.action.setBadgeText({ text: message.count.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
      
      // Guardar estado
      chrome.storage.local.set({
        lastSync: extensionState.lastSync,
        syncedCount: extensionState.totalSynced
      });
      
      sendResponse({ success: true });
      break;
      
    case 'SYNC_ERROR':
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
      sendResponse({ success: false, error: message.error });
      break;
      
    case 'GET_CONFIG':
      chrome.storage.local.get(['supabaseUrl', 'supabaseKey', 'isActive'], (data) => {
        sendResponse(data);
      });
      return true; // Mantener canal abierto para async
      
    case 'GET_STATUS':
      sendResponse({
        isActive: extensionState.isActive,
        lastSync: extensionState.lastSync,
        totalSynced: extensionState.totalSynced
      });
      break;
      
    default:
      sendResponse({ error: 'Unknown message type' });
  }
  
  return true;
});

// Limpiar badge después de un tiempo
function clearBadge() {
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
  }, 30000);
}

console.log('[CompraAgil] Background service worker iniciado');
