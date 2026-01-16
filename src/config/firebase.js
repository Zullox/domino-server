// ============================================================================
// CONFIGURACIÓN DE FIREBASE ADMIN SDK
// ============================================================================
import admin from 'firebase-admin';

let db = null;
let auth = null;

/**
 * Inicializar Firebase Admin SDK
 */
export const initFirebase = () => {
  try {
    // Verificar si ya está inicializado
    if (admin.apps.length > 0) {
      db = admin.firestore();
      auth = admin.auth();
      return;
    }

    // Opción 1: Usar archivo de credenciales
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID
      });
    } 
    // Opción 2: Usar variables de entorno
    else if (process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
    }
    // Opción 3: Modo desarrollo sin credenciales
    else {
      console.warn('[Firebase] ⚠️ Ejecutando sin credenciales de Firebase');
      console.warn('[Firebase] Algunas funcionalidades estarán limitadas');
      return;
    }

    db = admin.firestore();
    auth = admin.auth();
    
    console.log('[Firebase] ✅ Admin SDK inicializado');
  } catch (error) {
    console.error('[Firebase] Error de inicialización:', error.message);
  }
};

/**
 * Verificar token de Firebase Auth
 */
export const verifyToken = async (token) => {
  if (!auth) {
    console.warn('[Firebase] Auth no disponible');
    return null;
  }
  
  try {
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('[Firebase] Error verificando token:', error.message);
    return null;
  }
};

/**
 * Obtener documento de Firestore
 */
export const getDocument = async (collection, docId) => {
  if (!db) return null;
  
  try {
    const doc = await db.collection(collection).doc(docId).get();
    if (doc.exists) {
      return { id: doc.id, ...doc.data() };
    }
    return null;
  } catch (error) {
    console.error('[Firebase] Error obteniendo documento:', error);
    return null;
  }
};

/**
 * Actualizar documento de Firestore
 */
export const updateDocument = async (collection, docId, data) => {
  if (!db) return false;
  
  try {
    await db.collection(collection).doc(docId).update(data);
    return true;
  } catch (error) {
    console.error('[Firebase] Error actualizando documento:', error);
    return false;
  }
};

/**
 * Crear documento de Firestore
 */
export const createDocument = async (collection, docId, data) => {
  if (!db) return false;
  
  try {
    await db.collection(collection).doc(docId).set(data);
    return true;
  } catch (error) {
    console.error('[Firebase] Error creando documento:', error);
    return false;
  }
};

/**
 * Incrementar campo numérico
 */
export const incrementField = async (collection, docId, field, value = 1) => {
  if (!db) return false;
  
  try {
    await db.collection(collection).doc(docId).update({
      [field]: admin.firestore.FieldValue.increment(value)
    });
    return true;
  } catch (error) {
    console.error('[Firebase] Error incrementando campo:', error);
    return false;
  }
};

/**
 * Agregar elemento a array
 */
export const arrayAdd = async (collection, docId, field, value) => {
  if (!db) return false;
  
  try {
    await db.collection(collection).doc(docId).update({
      [field]: admin.firestore.FieldValue.arrayUnion(value)
    });
    return true;
  } catch (error) {
    console.error('[Firebase] Error agregando a array:', error);
    return false;
  }
};

/**
 * Batch write
 */
export const batchWrite = async (operations) => {
  if (!db) return false;
  
  try {
    const batch = db.batch();
    
    for (const op of operations) {
      const ref = db.collection(op.collection).doc(op.docId);
      
      if (op.type === 'set') {
        batch.set(ref, op.data, { merge: op.merge || false });
      } else if (op.type === 'update') {
        batch.update(ref, op.data);
      } else if (op.type === 'delete') {
        batch.delete(ref);
      }
    }
    
    await batch.commit();
    return true;
  } catch (error) {
    console.error('[Firebase] Error en batch write:', error);
    return false;
  }
};

/**
 * Consultar colección
 */
export const queryCollection = async (collection, conditions = [], orderByField = null, limitCount = 100) => {
  if (!db) return [];
  
  try {
    let query = db.collection(collection);
    
    // Aplicar condiciones
    for (const [field, operator, value] of conditions) {
      query = query.where(field, operator, value);
    }
    
    // Ordenar
    if (orderByField) {
      const [field, direction] = orderByField.split(':');
      query = query.orderBy(field, direction || 'asc');
    }
    
    // Limitar
    query = query.limit(limitCount);
    
    const snapshot = await query.get();
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('[Firebase] Error en consulta:', error);
    return [];
  }
};

export { db, auth, admin };
export default { initFirebase, verifyToken, getDocument, updateDocument, createDocument };
