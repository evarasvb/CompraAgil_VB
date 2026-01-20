// Popup script para CompraAgil Extension V2
// Corregido: manejo de errores de conexión

document.addEventListener('DOMContentLoaded', () => {
  const statusText = document.getElementById('statusText');
  const lastSyncEl = document.getElementById('lastSync');
  const totalSyncedEl = document.getElementById('totalSynced');
  const syncNowBtn = document.getElementById('syncNow');
  const openMercadoBtn = document.getElementById('openMercado');
  
  // Cargar estado inicial con manejo de errores
  loadStatus();
  
  // Botón sincronizar ahora
  syncNowBtn.addEventListener('click', async () => {
    syncNowBtn.textContent = 'Sincronizando...';
    syncNowBtn.disabled = true;
    
    try {
      // Buscar tab de Mercado Público
      const tabs = await chrome.tabs.query({ url: '*://buscador.mercadopublico.cl/*' });
      
      if (tabs.length > 0) {
        // Enviar mensaje al content script
        chrome.tabs.sendMessage(tabs[0].id, { type: 'MANUAL_SYNC' }, (response) => {
          // Verificar si hubo error de conexión
          if (chrome.runtime.lastError) {
            console.log('[CompraAgil] Content script no disponible:', chrome.runtime.lastError.message);
            showError('Recarga la página primero');
            return;
          }
          
          if (response && response.success) {
            syncNowBtn.textContent = 'Sincronizado!';
            setTimeout(() => {
              syncNowBtn.textContent = 'Sincronizar Ahora';
              syncNowBtn.disabled = false;
              loadStatus();
            }, 2000);
          } else {
            showError('Error al sincronizar');
          }
        });
      } else {
        // Abrir Mercado Público
        chrome.tabs.create({ url: 'https://buscador.mercadopublico.cl/compra-agil' });
        syncNowBtn.textContent = 'Abriendo...';
        setTimeout(() => {
          syncNowBtn.textContent = 'Sincronizar Ahora';
          syncNowBtn.disabled = false;
        }, 2000);
      }
    } catch (error) {
      showError('Error: ' + error.message);
    }
  });
  
  // Botón abrir Mercado Público
  openMercadoBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://buscador.mercadopublico.cl/compra-agil' });
  });
  
  function loadStatus() {
    // Verificar que chrome.runtime está disponible
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      console.log('[CompraAgil] Chrome runtime no disponible');
      return;
    }
    
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      // Manejar error de conexión
      if (chrome.runtime.lastError) {
        console.log('[CompraAgil] Background no disponible:', chrome.runtime.lastError.message);
        // Cargar desde storage como fallback
        loadFromStorage();
        return;
      }
      
      if (response) {
        statusText.textContent = response.isActive ? 'Activo' : 'Inactivo';
        statusText.className = 'status-value ' + (response.isActive ? 'active' : 'inactive');
        
        if (response.lastSync) {
          const date = new Date(response.lastSync);
          lastSyncEl.textContent = date.toLocaleString('es-CL');
        }
        
        totalSyncedEl.textContent = response.totalSynced || 0;
      }
    });
  }
  
  function loadFromStorage() {
    chrome.storage.local.get(['lastSync', 'syncedCount', 'isActive'], (data) => {
      if (chrome.runtime.lastError) {
        console.log('[CompraAgil] Storage error:', chrome.runtime.lastError.message);
        return;
      }
      
      if (data.isActive !== undefined) {
        statusText.textContent = data.isActive ? 'Activo' : 'Inactivo';
        statusText.className = 'status-value ' + (data.isActive ? 'active' : 'inactive');
      }
      
      if (data.lastSync) {
        const date = new Date(data.lastSync);
        lastSyncEl.textContent = date.toLocaleString('es-CL');
      }
      
      if (data.syncedCount) {
        totalSyncedEl.textContent = data.syncedCount;
      }
    });
  }
  
  function showError(message) {
    syncNowBtn.textContent = message;
    syncNowBtn.style.background = '#F44336';
    setTimeout(() => {
      syncNowBtn.textContent = 'Sincronizar Ahora';
      syncNowBtn.style.background = '';
      syncNowBtn.disabled = false;
    }, 3000);
  }
});

console.log('[CompraAgil] Popup V2 cargado');
