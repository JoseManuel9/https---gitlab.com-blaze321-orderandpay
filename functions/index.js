const functions = require('firebase-functions');
const admin = require('firebase-admin');
const moment = require('moment');
moment.locale('es');
const { user } = require('firebase-functions/lib/providers/auth');
admin.initializeApp();

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-function

// Si se  crea un nuevo VOProductRating se debe buscar ese item por Id.
// Se debe extraer el campo score y notes
// Si notes no existe se considera como cero
// Se obtiene el nuevo score = ((score*notes) + rating) /  (notes+1)
// El trigger debe modificar en el VOItems score con el nuevo valor obtenido y a notes se le suma 1

exports.funcRatingsCalculate = functions.firestore.document('/ratings/{idRestaurante}/{idItem}/{idUsuario}')
    .onCreate((snap, context) => {
        //console.log("el doc que se creo ", snap.data());
        const idRestaurante = context.params.idRestaurante;
        const idItem = context.params.idItem;
        //functions.logger.log('el doc que se creo', snap.data());
        var rating = parseInt(snap.data()['rating']);
        return admin.firestore().collection("items").doc(idRestaurante)
            .collection("itemsRes").where('idItem', '=', idItem).get().then(snapshot => {
                const promises = [];
                snapshot.forEach(doc => {
                    //functions.logger.log("el rating: ", rating);
                    var score = parseFloat(isNaN(doc.data()['itemScore']) ? 0 : doc.data()['itemScore']);
                    //functions.logger.log("el score ", score);
                    var notes = parseInt(isNaN(doc.data()['notes']) ? 0 : doc.data()['notes']);
                    //functions.logger.log("el notes ", notes);
                    var newScore = ((score * notes) + rating) / (notes + 1);
                    //functions.logger.log("el newScore ", newScore);
                    promises.push(doc.ref.update({ 'itemScore': parseFloat(newScore.toFixed(1)), 'notes': (notes + 1) }));
                });
                return Promise.all(promises)
            })
            .catch(error => {
                functions.logger.log("******el error que obtube funcRatingsCalculate: ", error);
                return null;
            });
    });


// 2. La creacion de este objeto genera un trigger que hace lo siguiente
// -Revisa si en notifiations>>retro>>idRestaurante>>retro existe este doc,  si existe continua
// -Revisa si en quiz>>idRestaurante>>retro>>idUsuario ya existe documento
// SI no existe se Agrega un timer para que dentro de un tiempo T haga lo siguiente:
// -Se llena un objeto VONotification con los datos de 
// notifications>>retro>>idRestaurante>>retro ademas de que se agrega la fecha de envío
// -Este objeto se crea en:
// messageCenter>>idUsuario>>idUsuario>>idRestaurante
// Se le envía una push notification con el titulo de VONotification que al presionarla abre la app (ya veremos que pantalla)
// 3. Cuando presiona una push del historico se valida el tipo de notificación, si es tipo 0 se inicia el flujo de retro
// Para enviar una retro se crea un objeto VORetro en:
// quiz>>idRestaurante>>retro>>idUsuario


exports.funcNotifyRetroVisit = functions.firestore.document('/visits/{restaurantId}/{Idrestaurant}/{Id}')
    .onCreate((snap, context) => {
        //console.log();
        //functions.logger.log("el doc que se creo ", snap.data());
        const restaurantId = context.params.restaurantId;
        const userId = snap.data()['userId'];
        return admin.firestore().collection("notifications").doc('retro')
            .collection(restaurantId).doc('retro').get().then(notifications => {
                if (notifications.exists) {
                    //functions.logger.log("la notifications que encontre", notifications.data());
                    return getQizz(notifications, restaurantId, userId);
                } else {
                    functions.logger.log("***** No exixte la configuración de retro para restaurantId:", restaurantId);
                    return null;
                }
            })
            .catch(error => {
                functions.logger.log("******error el obtener notifications: ", error);
                return null;
            });
    });


function getQizz(notifications, restaurantId, userId) {
    return admin.firestore().collection("quiz").doc(restaurantId)
        .collection('retro').doc(userId).get().then(quiz => {
            if (!quiz.exists) {
                //functions.logger.log("el quiz que encontre", quiz.data());
                return getUser(notifications, restaurantId, userId);
            } else {
                functions.logger.log("***** La retro ya exixte por el usuario:", userId);
                return null;
            }

        })
        .catch(error => {
            functions.logger.log("******error al obtener quizz: ", error);
            return null;
        });
}

function getUser(notifications, restaurantId, userId) {
    return admin.firestore().collection("users").where('userId', '=', userId).get().then(users => {
        const promises = [];
        users.forEach(doc => {
            //functions.logger.log("el users que encontre", doc.data());
            promises.push(admin.firestore().collection("messageCenter").doc(userId).collection(userId).doc(restaurantId).get().then(centerMsg => {
              if (!centerMsg.exists) {
                promises.push(admin.firestore().collection("messageCenter").doc(userId).collection(userId).doc(restaurantId).set({
                    'restaurantId': notifications.data()['restaurantId'],
                    'restaurantName': notifications.data()['restaurantName'],
                    'title': notifications.data()['title'],
                    'description': notifications.data()['description'],
                    'id': notifications.data()['id'],
                    'image': notifications.data()['image'],
                    'dtCreated': moment().format('MM-DD-YYYY hh:mm:ss'),
                    'dtSended': null,
                    'dtValidity': notifications.data()['dtValidity'],
                    'type': notifications.data()['type'],
                    'link': notifications.data()['link'],
                    'watched': false,
                    'isSended': false,
                }));
              }
            }).catch(error => {
                functions.logger.log("******error al obtener el messageCenter: ", error);
                return null;
            }));
        });
        return Promise.all(promises);
    }).catch(error => {
        functions.logger.log("******error al obtener el usuario: ", error);
        return null;
    });
}


// -Necesitamos un trigger que escuche en la base de datos:
// notifications>>promo>>idRestaurante
// Aqui hay 2 eventos, uno cuando crean una promo, en ese caso no hay nada que hacer pero cuando ya exista un objeto de estos que son del tipo VOAdminNotification puede haber otra modificación que es cuando el campo "priority" aparece o cambia esto significa que se ha disparado esta notificacion
// Este campo priority es un entero y hace referencia al catalogo notificationPriority, de momento solo se les pondrá un cero
// Cuando el priority aparezca en el objeto se lanzara una push con ese contenido a todos los usuarios que han hecho una visita a el restaurante que la lanzó.
// De momento esta es la única condición pero aquí tendremos algunas otras
// Cuando se lanza esa push en ese mismo VoAdminNotification se registra fecha y hora de cuando se lanzó en el campo dtSended

exports.funcUpdNotifySendPromo = functions.firestore.document('notifications/promo/{restauranId}/{Id}')
    .onUpdate((change, context) => {
        const restauranId = context.params.restauranId;
        const Id = context.params.Id;
        const newValue = change.after.data();
        const previousValue = change.before.data();
        const sendListId = [];
        //deteceted chance in field priority === 0
        if (newValue.priority !== previousValue.priority && newValue.priority === 1) {
            functions.logger.log("NEW priority send push", previousValue.priority);
            return admin.firestore().collection("visits").doc(restauranId).collection(restauranId).get().then(users => {
                functions.logger.log("encontre total de visitas: ", users.docs.length);
                users.forEach(doc => {
                    //functions.logger.log("la visita que encontre ", doc.data());
                    if (!sendListId.includes(doc.data()['userId'])) {
                        sendListId.push(doc.data()['userId']);
                    }
                });
                functions.logger.log("filtre total de visitas: ", sendListId.length);
                return getUserSendNotify(newValue, sendListId, restauranId, Id);

            }).catch(error => {
                functions.logger.log("******error al obtener el visitas: ", error);
                return null;
            });

        }
        return null;
    });

function getUserSendNotify(newValue, sendListId, restauranId, Id) {
    const promises = [];
    sendListId.forEach(e => {
        promises.push(admin.firestore().collection("users").where('userId', '=', e).get().then(users => {
            users.forEach(doc => {
                functions.logger.log("el usersId que encontre", doc.data()['userId']);
                //add push in promise
                var message = {
                    notification: {
                        title: newValue.title,
                        body: newValue.description,
                        image: newValue.image,
                    },
                    token: doc.data()['token'],
                    data: {
                        "type": newValue.type != null ? newValue.type.toString() : "",
                        "link": newValue.link != null ? newValue.link : "",
                        "click_action": "FLUTTER_NOTIFICATION_CLICK"
                    }
                };
                promises.push(admin.messaging().send(message));
            });
        }).catch(error => {
            functions.logger.log("******error al obtener el usuario: ", error);
            return null;
        }));
    });
    //upd to 1 priority in doc VOAdminNotification and dtSended
    promises.push(admin.firestore().collection("notifications").doc("promo").collection(restauranId).doc(Id).update({ priority: 0, dtSended: moment().format('yyyy/MM/dd') }));
    return Promise.all(promises);
}

//function que se ejecutara diario en un horario especifico
//Debe de Buscar todas la notificaciones pendientes en messageCenter>>idUsuario>>idUsuario>>idRestaurante
//y enviar push activar las notificacines visibles y marcar como enviadas

//exports.schdFuncSendPushRetro = functions.pubsub.schedule('every 30 minutes from 10:00 to 14:00')
exports.schdFuncSendPushRetro = functions.pubsub.schedule('every 30 minutes from 10:00 to 14:00')
    //.timeZone('us-central1')
    .onRun((context) => {
        const promises = [];
        functions.logger.log('****Se ejecuta every 30 minutes from 10:00 to 14:00');
        return admin.firestore().collection("messageCenter").listDocuments().then(centers => {
            centers.forEach(docCenter => {
                //functions.logger.log("***** se econtro", doc.collection(doc.id).id);
                promises.push(admin.firestore().collection("messageCenter").doc(docCenter.id).collection(docCenter.id).where('isSended', '=', false).get().then(notify => {
                    notify.forEach(docNoty => {
                        var mydate = moment(docNoty.data()['dtCreated']).format('MM-DD-YYYY hh:mm:ss');
                        var now = new Date();
                        var mydatehoy = moment(now).utc();
                        var ayer = moment(mydatehoy).subtract(1, 'days');
                        functions.logger.log("mi fecha que se creo ", moment(mydate).format('MM-DD-YYYY'));
                        //functions.logger.log("mi mydatehoy convert ", moment(mydatehoy).format('MM-DD-YYYY'));
                        functions.logger.log("mi fecha de ayer convert ", moment(ayer).format('MM-DD-YYYY'));
                        if (moment(mydate).format('MM-DD-YYYY') === moment(ayer).format('MM-DD-YYYY')) {
                            promises.push(admin.firestore().collection("users").where('userId', '=', docCenter.id).get().then(users => {
                                users.forEach(docUs => {
                                    functions.logger.log("el usersId que encontre", docUs.data()['userId']);
                                    //add push in promise
                                    var message = {
                                        notification: {
                                            title: docNoty.data()['title'],
                                            body: docNoty.data()['description'],
                                            image: docNoty.data()['image'],
                                        },
                                        token: docUs.data()['token'],
                                        data: {
                                            "type": docNoty.data()['type'] != null ? docNoty.data()['type'].toString() : "",
                                            "link": docNoty.data()['link'] != null ? docNoty.data()['link'] : "",
                                            "click_action": "FLUTTER_NOTIFICATION_CLICK"
                                        }
                                    };
                                    promises.push(admin.messaging().send(message));
                                });
                            }).catch(error => {
                                functions.logger.log("******error al obtener el usuario: ", error);
                                return null;
                            }));
                            //upd notify issended and datesend
                            promises.push(admin.firestore().collection("messageCenter").doc(docCenter.id).collection(docCenter.id).doc(docNoty.id).update({ isSended: true, dtSended: moment().format('yyyy/MM/dd') }));
                        }
                    });
                }).catch(error => {
                    functions.logger.log("******error al obtener el notify: ", error);
                    return null;
                }));
            });

            return Promise.all(promises);
        }).catch(error => {
            functions.logger.log("******error al obtener messageCenter: ", error);
            return null;
        });
    });