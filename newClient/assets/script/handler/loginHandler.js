var MessageHandler = require("msgHandler");
var enterGameBack = {};
enterGameBack['interest'] = "enterGameBack";
enterGameBack['Process'] = function (message) {
    GameLog(message);
    
    GameData.userId = message.userId;
    if (message.loginType === 'guest') {
        GameData.userName = message.name;
        GameData.userHeadUrl = message.headUrl;
    }
    
    GameEvent().SendEvent("LoginSuccess");
};
MessageHandler.Add(enterGameBack);