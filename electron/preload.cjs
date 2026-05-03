'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__electron__', { isElectron: true });
