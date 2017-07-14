if(typeof module !== 'undefined')
    module.exports = Room;
    
var Player = require("./Player.js");
var Mahjong = require("./Mahjong.js");

var UserDB = require("./sql/userDB.js");
var GameDB = require("./sql/gameDB.js");

var Replay = require('./Replay');

var MinuteToMicroSecond = 60000;

var enum_Pass = 0;
var enum_Niu = 1;
var enum_Chi = 2;
var enum_Kan = 3;
var enum_Jiang = 4;
var enum_Peng = 5;
var enum_Gang = 6;
var enum_Hu = 7;

var enum_Rule_ZhuangXian = 1;
var enum_Rule_Niu = enum_Rule_ZhuangXian << 1;
var enum_Rule_Jiang = enum_Rule_ZhuangXian << 2;
var enum_Rule_Chi = enum_Rule_ZhuangXian << 3;

// 11-19 筒子
// 21-29 万子
// 31-39 条子
// 45 红中 46 发财 47 白板
// 30种牌, 每种4张 合计120张牌

// 初始化牌顺序
var staticCards = new Array(11,11,11,11, 12,12,12,12, 13,13,13,13, 14,14,14,14, 15,15,15,15, 16,16,16,16, 17,17,17,17, 18,18,18,18, 19,19,19,19, 
                            21,21,21,21, 22,22,22,22, 23,23,23,23, 24,24,24,24, 25,25,25,25, 26,26,26,26, 27,27,27,27, 28,28,28,28, 29,29,29,29,
                            31,31,31,31, 32,32,32,32, 33,33,33,33, 34,34,34,34, 35,35,35,35, 36,36,36,36, 37,37,37,37, 38,38,38,38, 39,39,39,39, 
                            45,45,45,45, 46,46,46,46, 47,47,47,47);

function PlayData()
{
    this.userId = 0;
    this.userName = this.name;
    this.userHeadUrl = this.headUrl;
    this.offline = true;            // 离线
    this.place = 0;
    this.cards = null;              // 手牌
    this.outputCards = new Array(); // 已经出的牌
    this.pengCards = new Array();   // 已碰的牌
    this.gangCards = new Array();   // 已杠的牌
    this.kanCards = new Array();    // 已砍的牌
    this.niuCards = new Array();    // 已牛的牌
    this.chiCards = new Array();    // 已吃的牌
    this.jiangCards = new Array();  // 已将的牌
    this.huCards = new Array();     // 可胡的牌
    this.score = 0;                 // 单局分数
    this.singleScore = 0;           // 单局结算分数
    this.totalScore = 0;            // 总局结算分数
    this.updateHucards = true;
    this.isHuCards = false;
    this.canNiu = false;
    this.firstAdd = false;
    this.piao = false;
    this.piaoCard = 0;
}

function Room(server)
{
    this.server = server;

    this.duration = 0;      // 持续时间
    this.players = [null, null, null, null]; // 玩家列表
    this.playData = null; // 游戏数据
    
    this.cards = null; 
    this.cardsIndex = 0;
    this.bankerPlace = 0;   // 庄家
    this.getCardPlace = 0;  // 摸牌人
    this.checks = new Array();
    this.lastThrowCard = 0;
    this.lastThrowPlace = 0;
    this.started = false;   // 游戏已经开始
    this.playing = false;   // 游戏中
    this.pause = false;     // 玩家离线,游戏暂停
    this.state = 1;         // (摸牌状态 1, 打牌状态2, 结算状态3)
    
    // 创建时间
    var now = (new Date()).getTime();
    var time = Math.ceil(now / MinuteToMicroSecond);
    this.time = time;
}

Room.prototype.Init = function(id, createUserId, ruleId, quanId, hunCount, playCount, costMoney, bankerCount)
{
    var me = this;
    me.id = id;
    me.roomName = "room:"+me.id;
    me.createUserId = createUserId;
    me.ruleId = ruleId;
    me.quanId = quanId;
    me.hunCount = hunCount;
    me.playCount = playCount;
    me.costMoney = costMoney;
    me.bankerCount = bankerCount;   // 庄记数

    this.replay = new Replay(this);
}

Room.prototype.Shutdown = function() {
    var me = this;
    for (var i = 0; i < me.players.length; ++i) {
        if (me.players[i]) {
            GameLog(typeof me.server.IsRobot);
            if (me.server.IsRobot(me.players[i].uniqueID)) {
                // 机器人不写数据库
            }else {
                GameDB.UpdateRoomData(me.players[i].id, {});
            }
            
            me.RemovePlayer(me.players[i], false);
        }
    }
    me.server.DeleteRoom(me.id);
}

Room.prototype.RuleHasZhuangXian = function() {
    var me = this;
    if ((me.ruleId & enum_Rule_ZhuangXian) === enum_Rule_ZhuangXian) {
        return true;
    }
    return false;
}

Room.prototype.RuleCanNiu = function() {
    var me = this;
    if ((me.ruleId & enum_Rule_Niu) === enum_Rule_Niu) {
        return true;
    }
    return false;
}

Room.prototype.RuleCanJiang = function() {
    var me = this;
    if ((me.ruleId & enum_Rule_Jiang) === enum_Rule_Jiang) {
        return true;
    }
    return false;
}

Room.prototype.RuleCanChi = function() {
    var me = this;
    if ((me.ruleId & enum_Rule_Chi) === enum_Rule_Chi) {
        return true;
    }
    return false;
}

Room.prototype.IsFullQuan = function() {
    var me = this;
    if (me.quanId === 1) {
        // 1圈,4次轮庄.
        if (me.bankerCount >= 4) {
            return true;
        }
    }
    else if (me.quanId === 2) {
        // 4圈,16次轮庄.
        if (me.bankerCount >= 16) {
            return true;
        }
    }
    
    return false;
}

Room.prototype.GetFreePlace = function()
{
    var me = this;
    for (var i = 0; i < me.players.length; ++i) {
        if (me.players[i] === null)
            return i;
    }
    return -1;
}

Room.prototype.GetPlayerCount = function()
{
    var me = this;
    var count = 0;
    for (var i = 0; i < me.players.length; ++i) {
        if (me.players[i] !== null)
            ++count;
    }
    return count;
}

Room.prototype.HasPlayer = function(player){
    var me = this;
    for (var i = 0; i < me.players.length; ++i) {
        if (me.players[i] !== null && me.players[i].id === player.id) {
            return true;
        }
    }
    return false;
}

Room.prototype.PlayerCanEnter = function(player)
{
    var me = this;
    if (me.playData === null) {
        return true;
    }
    else {
        for (var i = 0; i < 4; ++i) {
            if (me.playData[i].userId === player.id) {
                return true;
            }
        }
    }
    return false
}

Room.prototype.CancelPlayerReady = function(id)
{
    var me = this;
    for (var i = 0; i < me.players.length; ++i) {
        if (me.players[i] !== null)
            me.players[i].ready = false;
    }
}

Room.prototype.CheckAllReady = function(id) {
    var me = this;
    var count = 0;
    for (var i = 0; i < me.players.length; ++i) {
        if (me.players[i] !== null && me.players[i].ready === true)
            ++count;
    }

    if (count === 4) {
        me.NewGame();
    }
}

Room.prototype.CheckAllAgreeDestoryRoom = function(timeOut) {
    var me = this;
    if (me.playData === null) {
        return;
    }
    
    var cannotAgree = false;
    for (var i = 0; i < me.playData.length; ++i) {
        if (typeof me.playData[i].agreeDestoryRoom === 'undefined') {
            if (typeof timeOut === 'undefined') {
                return;
            }
        }
        
        if (me.playData[i].agreeDestoryRoom === 0) {
            cannotAgree = true;
        }
    }

    if (cannotAgree === false) {
        // 结算
        GameLog(me.roomName + "发起总结算");
        var reqEnd = 3;
        Room.prototype.SendAccountsCards(me, reqEnd);
        me.Shutdown();
    }else {
        me.BroadcastPlayers(null, "cancelDestoryRoom");
        for (var i = 0; i < me.playData.length; ++i) {
            me.playData[i].agreeDestoryRoom = undefined;
        }
    }
    
    if (typeof timeOut === 'undefined' && typeof me.reqDestoryRoomHandle !== 'undefined') {
        clearTimeout(me.reqDestoryRoomHandle);
        me.reqDestoryRoomHandle = undefined;
    }
}

// 通知玩家准备游戏
Room.prototype.SendPlayerReady = function(){
    var me = this;
    if (me.GetPlayerCount() === 4) {
        me.BroadcastPlayers(null, "ready");
    }
}

// 玩家过牌
Room.prototype.PlayerPassOperate = function(player){
    var me = this;
    var process = false;
    var checkEvent;
    for (var i = 0; i < me.checks.length; ++i) {
        checkEvent = me.checks[i];
        if (checkEvent.place === player.data.place) {
            checkEvent['select'] = enum_Pass;
            process = true;
            break;
        }
    }

    if (process) me.ProcessCheck();
}

// 添加玩家
Room.prototype.AddPlayer = function(player)
{
    var me = this;

    PROCESS_COCOS_SOCKETIO(player.socket, 'exitRoom', function (data) {
        // GameLog('exitRoom');
        
        if (me.started) {
            GameLog("游戏已经开始,不能直接退出,只能发起总结算");
            return;
        }
        
        if (typeof player.room === 'undefined') {
            GameLog("没有加入房间");
            return;
        }
        
        me.BroadcastPlayers(null, "exitRoomBack", player.id);
        
        if (me.createUserId !== player.id) {
            GameDB.UpdateRoomData(player.id, {});
            me.RemovePlayer(player);
        }
        else {
            me.Shutdown();
        }
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'reqDestoryRoom', function (data) {
        // GameLog('reqDestoryRoom');
        
        if (me.started === false) {
            GameLog("游戏已经未开始,不用发起总结算");
            return;
        }
        
        if (typeof player.room === 'undefined') {
            GameLog("没有加入房间");
            return;
        }
        
        for (var i = 0; i < me.playData.length; ++i) {
            if (me.playData[i].agreeDestoryRoom === 2) {
                GameLog("已经有人发起总结算")
                return;
            }
        }
        
        player.data.agreeDestoryRoom = 2;
        me.SendDestoryRoom(me);
        me.reqDestoryRoomHandle = setTimeout(function() {
            me.CheckAllAgreeDestoryRoom(true);
        }.bind(), 63 * 1000);
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'rspDestoryRoom', function (data) {
        // GameLog('reqDestoryRoom');
        
        if (me.started === false) {
            GameLog("游戏已经未开始,不用发起总结算");
            return;
        }
        
        if (typeof player.room === 'undefined') {
            GameLog("没有加入房间");
            return;
        }
        
        if (typeof player.data.agreeDestoryRoom !== 'undefined') {
            GameLog("已经提交投票结果");
            return;
        }
        
        player.data.agreeDestoryRoom = (data.agree === 1 ? 1 : 0);
        me.SendDestoryRoom(me);
        // 检测是否全部投票完毕.
        me.CheckAllAgreeDestoryRoom();
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'ready', function (data) {
        // GameLog('ready');
        if (me.playing === true) { GameLog("不合法的消息请求"); return; }
        player.ready = true;
        me.BroadcastPlayers(null, "readyOk", player.place);
        
        me.CheckAllReady();
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'unready', function (data) {
        if (me.playing === true) { GameLog("不合法的消息请求"); return; }
        player.ready = false;
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'voice', function (data) {
        // GameLog('voice');
        me.BroadcastPlayers(null, "voiceBack", data);
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'needThrowCard', function(data) {
        if (me.playing === false || me.pause === true) { GameLog("不合法的消息请求"); return; }
        var card = data.card;
        if (me.getCardPlace === player.data.place && me.checks.length === 0) {
            if(player.data.piao === true && player.data.cards[player.data.cards.length-1] !== card) { GameLog("已经飘牌,只能打出最后摸起的牌!"); return; }
            if(player.ThrowCard(card)) {
                // 打牌状态
                me.state = 2;

                me.lastThrowCard = card;
                me.lastThrowPlace = player.data.place;
                me.BroadcastPlayers2(player, "throwCard", card);

                me.replay.AddAction('throwCard', player.place, card);
                
                if (typeof data.piao !== 'undefined' && player.data.piao === false && player.CanPiao()) {
                    player.data.piao = true;
                    me.BroadcastPlayers(player, "piaoCards", { place : player.data.place, card : me.lastThrowCard });

                    me.replay.AddAction('throwCard', player.place, me.lastThrowCard);
                }
                
                // 检测碰,杠,胡.
                //    如果有玩家碰,那么通知玩家,有玩家出牌,出现时间选择是否碰牌. 非碰牌玩家依然显示玩家尚未出牌.
                //        碰牌玩家选择碰牌, 通知非碰牌玩家有玩家出牌, 通知非碰牌玩家有人碰牌.

                if (false === me.ThrowCardCheck(player, card)) {
                    me.DoBackCardPlace();
                    me.PlayerAddCard();
                }
            }
        }
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'pengCards', function(data) {
        if (me.playing === false || me.pause === true) { GameLog("不合法的消息请求"); return; }
        var process = false;
        var checkEvent;
        for (var i = 0; i < me.checks.length; ++i) {
            checkEvent = me.checks[i];
            if (checkEvent.place === player.data.place && typeof checkEvent.peng !== 'undefined') {
                checkEvent['select'] = enum_Peng;
                process = true;
                break;
            }
        }
        
        if (process) me.ProcessCheck();
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'gangCards', function(data) {
        if (me.playing === false || me.pause === true) { GameLog("不合法的消息请求"); return; }
        var process = false;
        var checkEvent;
        for (var i = 0; i < me.checks.length; ++i) {
            checkEvent = me.checks[i];
            if (checkEvent.place === player.data.place && typeof checkEvent.gang !== 'undefined') {
                checkEvent['select'] = enum_Gang;
                process = true;
                break;
            }
        }
        
        if (process) me.ProcessCheck();
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'huCards', function(data) {
        if (me.playing === false || me.pause === true) { GameLog("不合法的消息请求"); return; }
        var process = false;
        var checkEvent;
        for (var i = 0; i < me.checks.length; ++i) {
            checkEvent = me.checks[i];
            if (checkEvent.place === player.data.place && typeof checkEvent.hu !== 'undefined') {
                checkEvent['select'] = enum_Hu;
                process = true;
                break;
            }
        }
        
        if (process) me.ProcessCheck();
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'kanCards', function(data) {
        if (me.playing === false || me.pause === true) { GameLog("不合法的消息请求"); return; }
        // GameLog("kanCards");
        var process = false;
        var checkEvent;
        for (var i = 0; i < me.checks.length; ++i) {
            checkEvent = me.checks[i];
            if (checkEvent.place === player.data.place && typeof checkEvent.kan !== 'undefined') {
                checkEvent['select'] = enum_Kan;
                process = true;
                break;
            }
        }
        
        if (process) me.ProcessCheck();
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'niuCards', function(data) {
        if (me.playing === false || me.pause === true) { GameLog("不合法的消息请求"); return; }
        if (me.RuleCanNiu() === false) { GameLog("房间规则不能牛牌"); return; };
        var process = false;
        var checkEvent;
        for (var i = 0; i < me.checks.length; ++i) {
            checkEvent = me.checks[i];
            if (checkEvent.place === player.data.place && typeof checkEvent.niu !== 'undefined') {
                checkEvent['select'] = enum_Niu;
                process = true;
                break;
            }
        }
        
        if (process) me.ProcessCheck();
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'jiangCards', function(data) {
        if (me.playing === false || me.pause === true) { GameLog("不合法的消息请求"); return; }
        if (me.RuleCanJiang() === false) { GameLog("房间规则不能将牌"); return; };
        var process = false;
        var checkEvent;
        for (var i = 0; i < me.checks.length; ++i) {
            checkEvent = me.checks[i];
            if (checkEvent.place === player.data.place && typeof checkEvent.jiang !== 'undefined') {
                checkEvent['select'] = enum_Jiang;
                process = true;
                break;
            }
        }
        
        if (process) me.ProcessCheck();
    });

    PROCESS_COCOS_SOCKETIO(player.socket, 'chiCards', function(data) {
        if (me.playing === false || me.pause === true) { GameLog("不合法的消息请求"); return; }
        if (me.RuleCanChi() === false) { GameLog("房间规则不能吃牌"); return; };
        var process = false;
        var checkEvent;
        var kindIndex = data;
        for (var i = 0; i < me.checks.length; ++i) {
            checkEvent = me.checks[i];
            if (checkEvent.place === player.data.place && typeof checkEvent.chi !== 'undefined') {
                checkEvent['select'] = enum_Chi;
                checkEvent['appendix'] = typeof kindIndex === 'number' ? kindIndex : 0;
                process = true;
                break;
            }
        }
        
        if (process) me.ProcessCheck();
    });
    
    PROCESS_COCOS_SOCKETIO(player.socket, 'passCards', function(data) {
        if (me.playing === false || me.pause === true) { GameLog("不合法的消息请求"); return; }
        me.PlayerPassOperate(player);
    });
    
    if (false === me.started) {
        // 设置自己位子
        player.place = me.GetFreePlace();
        // 先通知自己创建自己的单位
        player.socket.emit("newPlayer", Player.prototype.SendNewPlayer(player, true));
        // 再通知其他玩家加入新玩家
        me.BroadcastPlayers(player, "newPlayer");  
        // 再自己创建其他玩家
        me.SendPlayersTo(player);
    }
    else {
       for (var pi = 0; pi < 4; ++pi) {
            if (me.playData[pi].userId === player.id) {
                player.place = me.playData[pi].place;
                player.AttachData(me.playData[pi]);
                break;
            }
        }

        // 发送牌数据.
        me.SendSendPlayersByReconnection(player);
        // 广播玩家上线.
        me.BroadcastPlayers(null, "playerReconnection", player.place);  

        var allOnline = true;
        for (var gi = 0; gi < 4; ++gi) {
            if (this.playData[gi].offline === true) {
                allOnline = false;
                break;
            }
        }
        
        if (allOnline) {
            me.pause = false;
            GameLog(player.name + "重新加入,游戏开始!");
        }
    }

    player.socket.join(me.roomName);
    me.players[player.place] = player;
    
    if (false === me.playing) {
        // 新一局准备
        me.SendPlayerReady();
    }
   
    // GameLog(player.name + ' enter ' + me.roomName);
}

// 移除玩家
Room.prototype.RemovePlayer = function(player, noBroadcast)
{
    var me = this;
    var place = player.place;
    if (place >= 0) {
        player.socket.leave(this.roomName);
        
        if (typeof noBroadcast === 'undefined') {
            if (me.started) {
                this.BroadcastPlayers(player, "playerOffline", player.place);
            }else {
                this.BroadcastPlayers(player, "losePlayer");
            }
        }

        this.players[place] = null;
        player.room = null;
        player.ready = false;
        if (me.started) {
            me.playData[place].offline = true;
            me.pause = true;
        }
        else {
            me.CancelPlayerReady();
        }
        
        GameLog(player.name + ' leave ' + me.roomName);
        GameLog("number of " + this.roomName +"'s player :", this.GetPlayerCount());
    }
}

// 情况所有玩家
Room.prototype.ClearAllPlayers = function()
{
    var me = this;
    me.players = [null, null, null, null];
}

Room.prototype.Update = function(dt)
{

}

// 广播
Room.prototype.BroadcastPlayers = function(who, action, argument)
{
    var me = this;
    if(action === "newPlayer") {
        IO.to(me.roomName).emit(action, Player.prototype.SendNewPlayer(who));
    }else if(action === "losePlayer") {
        IO.to(me.roomName).emit(action, Player.prototype.SendLosePlayer(who));
    }else if(action === "newGame") {
        IO.to(me.roomName).emit(action, argument);
    }else if(action === "ready") {
        IO.to(me.roomName).emit(action);
    }else if(action === 'exitRoomBack') {
        IO.to(me.roomName).emit(action, argument);
    }else if (action === 'readyOk') {
        IO.to(me.roomName).emit(action, argument);
    }else if (action === 'voiceBack') {
        IO.to(me.roomName).emit(action, argument);
    }else if (action === 'playerReconnection') {
        IO.to(me.roomName).emit(action, argument);
    }else if (action === 'playerOffline') {
        IO.to(me.roomName).emit(action, argument);
    }else if (action === 'piaoCards') {
        IO.to(me.roomName).emit(action, argument);
    }else if (action === 'destoryRoomBack') {
        IO.to(me.roomName).emit(action, argument);
    }else if (action === 'cancelDestoryRoom') {
        IO.to(me.roomName).emit(action);
    }
}

// 广播
Room.prototype.BroadcastPlayers2 = function(who, action, argument, argument2)
{
    var me = this;
    var player = null;
    for (var i = 0; i < me.players.length; ++i){
    
        player = me.players[i];
        if (player === null) continue;
        
        if(action === "initCards") {
            player.socket.emit(action, Player.prototype.SendInitCards(who, player.data.place === who.data.place));
        }else if(action === "getCard") {
            player.socket.emit(action, Player.prototype.SendGetCard(who, argument, player, argument2));
        }else if(action === "throwCard") {
            player.socket.emit(action, Player.prototype.SendThrowCard(who, argument, player));
        }else if(action === "pengCards") {
            player.socket.emit(action, Player.prototype.SendPengCards(who, argument, player, argument2));
        }else if(action === "gangCards") {
            player.socket.emit(action, Player.prototype.SendGangCards(who, argument, player, argument2));
        }else if(action === "huCards") {
            player.socket.emit(action, Player.prototype.SendHuCards(who, argument, player, argument2));
        }else if(action === "kanCards") {
            player.socket.emit(action, Player.prototype.SendKanCards(who, argument, player));
        }else if(action === "niuCards") {
            player.socket.emit(action, Player.prototype.SendNiuCards(who, argument, player));
        }else if(action == "addNiuCard") {
            player.socket.emit(action, Player.prototype.SendAddNiuCard(who, argument, player));
        }else if(action === "jiangCards") {
            player.socket.emit(action, Player.prototype.SendJiangCards(who, argument, player, argument2));
        }else if(action === "chiCards") {
            player.socket.emit(action, Player.prototype.SendChiCards(who, argument, player, argument2));
        }
    }
}

// 发送其他玩家数据
Room.prototype.SendPlayersTo = function(who)
{
    var me = this;
    var player = null;
    var datas = [];
    for (var i = 0; i < me.players.length; ++i){

        player = me.players[i];
        if (player === null) continue;
        
        datas.push(Player.prototype.SendPlayerInfo(player));
    }
    if (datas.length > 0) {
        who.socket.emit("playerList", datas);
    }
}

// 断线重连接发送所有玩家数据
Room.prototype.SendSendPlayersByReconnection = function(who)
{
    var me = this;
    var roomInfo = {
        "bankerPlace" : me.bankerPlace, 
        "playCount" : me.playCount,
        "getCardPlace" : me.getCardPlace,
        "totalScore" : [me.playData[0].totalScore,
                        me.playData[1].totalScore,
                        me.playData[2].totalScore,
                        me.playData[3].totalScore]
    }
   
    var state = {};    
    if (me.state === 1) {
        state.type = 1;
        state.getCardPlace = me.getCardPlace;
        state.getCard = me.cards[me.cardsIndex - 1];
    }else if (me.state === 2){
        state.type = 2;
        state.lastThrowPlace = me.lastThrowPlace;
        state.lastThrowCard = me.lastThrowCard;
    }else if (state.type === 3) {
        roomInfo.accounts = 1;
    }
    
    var playerData = null;
    var datas = [];
    for (var i = 0; i < me.playData.length; ++i) {
        playerData = me.playData[i];
        datas.push(Player.prototype.SendPlayerInfoByReconnection(playerData, state, who));
    }
    if (datas.length > 0) {
        who.socket.emit("resumeGame", { roomInfo : roomInfo, playerList : datas });
    }
}

function RandomNumBoth(Min,Max){
    var Range = Max - Min;
    var Rand = Math.random();
    var num = Min + Math.round(Rand * Range); //四舍五入
    return num;
}

// 洗牌
Room.prototype.RandomCards = function() {    
    // 打乱牌
    var i, a, b, t;
    var cardsMaxIdx = this.cards.length - 1;
    
    for (i = 0; i < 120; ++i) {
        a = Util.RandomRange(0, cardsMaxIdx);
        b = Util.RandomRange(0, cardsMaxIdx);
        if (a !== b) {
            t = this.cards[b];
            this.cards[b] = this.cards[a];
            this.cards[a] = t;
        }
    }
}

// 定势洗牌
Room.prototype.FixCards = function() {
    // 先随机一下牌
    var i, a, b, t;
    var cardsMaxIdx = this.cards.length - 1;
    for (i = 0; i < 120; ++i) {
        a = Util.RandomRange(0, cardsMaxIdx);
        b = Util.RandomRange(0, cardsMaxIdx);
        if (a !== b) {
            t = this.cards[b];
            this.cards[b] = this.cards[a];
            this.cards[a] = t;
        }
    }
    
    var fixCards = [11,11,11,12,13,14,15,16,17,18,19,19,19,34,26,45,46,47,26,27,28,28,28];
    var t;
    for (var i = 0; i < fixCards.length; ++i) {
        for (var j = i; j < this.cards.length; ++j) {
            if (fixCards[i] == this.cards[j]) {
                if (i !== j) {
                    t = this.cards[i];
                    this.cards[i] = this.cards[j];
                    this.cards[j] = t;
                    break;
                }
            }
        }
    }
}

// 新一局游戏
Room.prototype.NewGame = function()
{
    var me = this;
    me.cards = staticCards.slice();
    me.cardsIndex = 0;
    me.started = true;
    me.playing = true;
    me.pause = false;
    me.checks.splice(0, me.checks.length);
    
    // 生成游戏数据
    if (me.playData === null) {
        me.playData = new Array(null,null,null,null);
        for (var pi = 0; pi < 4; ++pi) {
            me.playData[pi] = new PlayData();
            me.players[pi].AttachData(me.playData[pi]);
            
            if (me.players[pi].id === me.createUserId) {
                // 默认房主为庄
                me.bankerPlace = pi;
            }
        }
    }
 
    if (me.costMoney === 0) {
        // 如果没有扣钱,在这里扣钱
        me.costMoney = 1;
    }
    
    //me.RandomCards();
    me.FixCards();
    
    var roomInfo = {
        "bankerPlace" : me.bankerPlace,
        "playCount" : me.playCount,
        "played" : 1,
        "totalScore" : [me.playData[0].totalScore,
                        me.playData[1].totalScore,
                        me.playData[2].totalScore,
                        me.playData[3].totalScore]
    }
    
    me.BroadcastPlayers(null, "newGame", roomInfo);
    
    // 发牌
    var initCards = new Array(13);
    var i,j;
    for (i = 0; i < 4; ++i) {
        for (j = 0; j < 13; ++j, ++me.cardsIndex) {
            initCards[j] = me.cards[me.cardsIndex];
        }
        
        me.players[i].InitCards(initCards);
        //GameLog(initCards, i);
    }
    
    var player;
    for (i = 0; i < 4; ++i) {
        player = me.players[i];
        me.BroadcastPlayers2(player, "initCards");
    }
    
    me.getCardPlace = me.bankerPlace;

    // 录像开始
    me.replay.Start();
    
    // 庄家先摸牌
    me.PlayerAddCard();
}

// 下庄
Room.prototype.ChangeZhuang = function() {
    var me = this;
    ++me.bankerPlace;
    if (me.bankerPlace > 3) {
        me.bankerPlace = 0;
    }
    ++me.bankerCount;
}

// 下家抓牌
Room.prototype.DoBackCardPlace = function() {
    var me = this;
    me.getCardPlace = me.getCardPlace + 1;
    if (me.getCardPlace === 4) { 
        me.getCardPlace = 0; 
    }
}

// 玩家摸牌
Room.prototype.PlayerAddCard = function() {
    var me = this;
    // 摸牌状态
    me.state = 1;
    if (me.cardsIndex + 1 == (me.cards.length - 16)) {
        // 流局
        var liujuEnd = 1;
        me.ChangeZhuang();
        me.GameEnd(liujuEnd);
    }else {
        var player = me.players[me.getCardPlace];
        var card = me.cards[me.cardsIndex++];
        
        //GameLog("cardsIndex=", me.cardsIndex);

        me.replay.AddAction('addCard', player.place, card);

        if (player.data.niuCards.length > 0 && 
           (card === 45 || card === 46 || card === 47))
        {
            // 补牛
            player.AddNiuCard(card);
            me.BroadcastPlayers2(player, "addNiuCard", card);
            
            // 等待一秒继续补牌
            var getCardPlace = me.getCardPlace;
            me.getCardPlace = -1;
            function AddCardNextSecond(room, getCardPlace) {
                return function () {
                    room.getCardPlace = getCardPlace;
                    room.PlayerAddCard();
                };
            }
            setTimeout(AddCardNextSecond(me, getCardPlace), 2000);
        }
        else {
            
            player.AddCard(card);
            var checkEvent = null;
            if (player.data.piao === false && (Mahjong.HasGangCardsByHand(player.data.cards) ||
                Mahjong.HasGangCards(player.data.cards, card) || 
                Mahjong.CanGangCards(player.data.kanCards, card))) {
                if (checkEvent === null) {
                    checkEvent = { 'place' : player.data.place, 'selfCheck' : 1 };
                }
                checkEvent.gang = 1;
            }
            
            if (player.data.piao === false && (Mahjong.HasKanCardsByHand(player.data.cards) || 
                Mahjong.HasKanCards(player.data.cards, card)) ) {
                if (checkEvent === null) {
                    checkEvent = { 'place' : player.data.place, 'selfCheck' : 1 };
                }
                checkEvent.kan = 1;
            }
            
            if (me.RuleCanNiu() && player.data.canNiu) {
                if (checkEvent === null) {
                    checkEvent = { 'place' : player.data.place, 'selfCheck' : 1 };
                }
                checkEvent.niu = 1;
            }
            
            if (player.data.isHuCards) {
                if (checkEvent === null) {
                    checkEvent = { 'place' : player.data.place, 'selfCheck' : 1 };
                }
                checkEvent.hu = 1;
            }
            
            if (checkEvent !== null) {
                me.checks.push(checkEvent);
                // GameLog("trigger checkEvent(add card)---------------->");
            }
            
            var remainNumber = (me.cards.length - 1) - me.cardsIndex;
            me.BroadcastPlayers2(player, "getCard", card, remainNumber);
        }
    }
}

// 出牌检测
Room.prototype.ThrowCardCheck = function(player, card) {
    var me = this;
    var otherPlayer;
    var huCards;
    var checkEvent = null;

    function BIsANextPlace(placeA, placeB) {
        var nextPlace = placeA + 1;
        if (nextPlace === 4) { 
            nextPlace = 0; 
        }

        return nextPlace === placeB;
    }

    
    for (var i = 0; i < 4; ++i) {
        otherPlayer = me.players[i];
        if (otherPlayer.data.place === player.data.place)
            continue;
            
        checkEvent = null;
        if (otherPlayer.data.piao === false && 
            Mahjong.CanPengCards(otherPlayer.data.cards, card)) {
            if (checkEvent === null) {
                checkEvent = { 'place' : otherPlayer.data.place, 'throwCheck' : 1};
            }
            checkEvent.peng = 1;
        }
        
        if (otherPlayer.data.piao === false && 
            (Mahjong.CanGangCards(otherPlayer.data.cards, card) ||
            Mahjong.CanGangCards(otherPlayer.data.kanCards, card))) {
            if (checkEvent === null) {
                checkEvent = { 'place' : otherPlayer.data.place, 'throwCheck' : 1};
            }
            checkEvent.gang = 1;
        }
        
        // 将牌
        if (me.RuleCanJiang() && otherPlayer.data.piao === false) {
            if (BIsANextPlace(player.data.place, otherPlayer.data.place) &&
                otherPlayer.CanJiangCards(card)) {
                if (checkEvent === null) {
                    checkEvent = { 'place' : otherPlayer.data.place, 'throwCheck' : 1};
                }
                checkEvent.jiang = 1;
            }
        }

        // 吃牌
        if (me.RuleCanChi() &&
            BIsANextPlace(player.data.place, otherPlayer.data.place) &&
            Mahjong.CanChiCards(otherPlayer.data.cards, card))
        {
            if (checkEvent === null) {
                checkEvent = { 'place' : otherPlayer.data.place, 'throwCheck' : 1};
            }
            checkEvent.chi = 1;
        }
        
        huCards = otherPlayer.GetHuCards();
        for (var j = 0; j < huCards.length; ++j) {
            if (huCards[j] === card) {
                if (checkEvent === null) {
                    checkEvent = { 'place' : otherPlayer.data.place, 'throwCheck' : 1};
                }
                checkEvent.hu = 1;
                break;
            }
        }
        
        if (checkEvent !== null) {
            me.checks.push(checkEvent);
            // GameLog("trigger checkEvent(throw card)---------------->");
        }
    }
    
    return me.checks.length > 0;
}

function RuleSort(room) {
    // return < 0  排序后a在b前面
    // return === 0  排序后a,b位置不变
    // return > 0  排序后b在a前面

    return function CheckSort(a, b) {
        if (a.select === b.select) {
            var i = 0;
            var mod4;
            while (++i < 10) {
                mod4 = (room.getCardPlace + i) % 4;
                if (mod4 === a.place) {
                    return -1;
                }
                if (mod4 === b.place) {
                    return 1;
                }
            }
            return 0;
        }
        else {
            return b.select - a.select;
        }
    }
}

// 处理客户端检测事件
Room.prototype.ProcessEvent = function(place, select, selfCheck, appendix) {
    // GameLog("---------------->ProcessCheck:" + select);
    var me = this;
    var player = me.players[place];
    switch(select) {
        case enum_Hu: {
            GameLog("玩家" + player.name + "胡牌了");
            player.HuCards();
            me.CalcPlayersScore(place, selfCheck);
        
            if (place !== me.bankerPlace) {
                me.ChangeZhuang();
            }
            // 通知
            if (selfCheck) {
                me.BroadcastPlayers2(player, "huCards", me.cards[me.cardsIndex - 1]);

                me.replay.AddAction('huCards', player.place, me.cards[me.cardsIndex - 1]);
            }else {
                me.BroadcastPlayers2(player, "huCards", me.lastThrowCard, me.lastThrowPlace);

                me.replay.AddAction('huCards', player.place, { card : me.lastThrowCard, throwPlace : me.lastThrowPlace});
            }

            var huEnd = 2;
            me.GameEnd(huEnd);
        }break;
        case enum_Gang: {
            me.PlayerGangCards(player, selfCheck);
            me.RemoveLastOneInPlayerOutputCards();
        }break;
        case enum_Peng: {
            me.PlayerPengCards(player);
            me.RemoveLastOneInPlayerOutputCards();
        }break;
        case enum_Niu: {
            me.PlayerNiuCards(player);
        }break;
        case enum_Kan: {
            me.PlayerKanCards(player);
        }break;
        case enum_Jiang : {
            me.PlayerJiangCards(player);
            me.RemoveLastOneInPlayerOutputCards();
        }break;
        case enum_Chi : {
            if(me.PlayerChiCard(player, appendix)) {
                me.RemoveLastOneInPlayerOutputCards();
            }
        }break;
        case enum_Pass: {
            if (selfCheck === false) {
                me.DoBackCardPlace();
                me.PlayerAddCard();
            }
        }break;
    }
}

// 处理检测
Room.prototype.ProcessCheck = function() {

    function SimpleClone(src) {
        var dst = {}
        for (var key in src) {
            dst[key] = src[key]
        }
        return dst;
    }

    function SelectMaxCheckEvent(checkEvent)
    {
        if (typeof checkEvent.select !== "undefined") {
            return checkEvent.select;
        }

        if (typeof checkEvent.hu !== 'undefined') 
            return enum_Hu;

        if (typeof checkEvent.gang !== 'undefined') 
            return enum_Gang;

        if (typeof checkEvent.peng !== 'undefined') 
            return enum_Peng;

        if (typeof checkEvent.jiang !== 'undefined') 
            return enum_Jiang;
        
        if (typeof checkEvent.chi !== 'undefined')
            return enum_Chi;

        if (typeof checkEvent.kan !== 'undefined') 
            return enum_Kan;

        if (typeof checkEvent.niu !== 'undefined') 
            return enum_Niu;

        return enum_Pass;
    }

    var me = this;
    var cloneChecks = new Array();
    var checkEvent;
    for (var i = 0; i < me.checks.length; ++i) {
        checkEvent = SimpleClone(me.checks[i]);
        cloneChecks.push(checkEvent);
        checkEvent.select = SelectMaxCheckEvent(checkEvent);
    }

    // 客户全部选择完毕,此刻处理
    if (cloneChecks.length > 0) {
        cloneChecks.sort(RuleSort(me));
        checkEvent = cloneChecks[0];
        
        for (var i = 0; i < me.checks.length; ++i) {
            if (checkEvent.place === me.checks[i].place) {
                if (typeof me.checks[i].select !== 'undefined')
                {
                    var checkEvent = me.checks[i];
                    var select = checkEvent.select;
                    var place = checkEvent.place;
                    var selfCheck = typeof checkEvent.selfCheck !== 'undefined'
                    var appendix = checkEvent.appendix;
                    // 清除事件
                    me.checks.splice(0, me.checks.length);
                    // 处理事件
                    me.ProcessEvent(place, select, selfCheck, appendix);
                }
                break;
            }
        }
    }
}

// 检测手牌
Room.prototype.TriggerSelfCheck = function(player)
{
    var me = this;
    var checkEvent = null;
    if (Mahjong.HasGangCardsByHand(player.data.cards)) {
        if (checkEvent === null) {
            checkEvent = { 'place' : player.data.place, 'selfCheck' : 1 };
        }
        checkEvent.gang = 1;
    }
    
    if (Mahjong.HasKanCardsByHand(player.data.cards)) {
        if (checkEvent === null) {
            checkEvent = { 'place' : player.data.place, 'selfCheck' : 1 };
        }
        checkEvent.kan = 1;
    }
    
    if (me.RuleCanNiu() && player.data.canNiu) {
        if (checkEvent === null) {
            checkEvent = { 'place' : player.data.place, 'selfCheck' : 1 };
        }
        checkEvent.niu = 1;
    }

    if (player.data.isHuCards) {
        if (checkEvent === null) {
            checkEvent = { 'place' : player.data.place, 'selfCheck' : 1 };
        }
        checkEvent.hu = 1;
    }
    
    if (checkEvent !== null) {
        this.checks.push(checkEvent);
        //GameLog("trigger checkEvent(self check)---------------->");
    }
}

// 玩家杠牌
Room.prototype.PlayerGangCards = function (player, selfCheck) {
    var me = this;

    if (selfCheck) {
        player.GangCards(me.cards[me.cardsIndex - 1], true);
        me.BroadcastPlayers2(player, "gangCards", me.cards[me.cardsIndex - 1]);
    }else {
        player.GangCards(me.lastThrowCard, false);
        me.BroadcastPlayers2(player, "gangCards", me.lastThrowCard, me.lastThrowPlace);
    }
    me.getCardPlace = player.data.place;
    me.PlayerAddCard();

    me.replay.AddAction('gangCards', player.place, { card : me.lastThrowCard, throwPlace : me.lastThrowPlace} );
}

// 玩家碰牌
Room.prototype.PlayerPengCards = function (player) {
    var me = this;
    // 玩家碰牌
    player.PengCards(me.lastThrowCard);
    // 触发检测
    me.TriggerSelfCheck(player);
    // 通知
    me.BroadcastPlayers2(player, "pengCards", me.lastThrowCard, me.lastThrowPlace);
    // 改变出牌位置
    me.getCardPlace = player.data.place;

    me.replay.AddAction('pengCards', player.place, { card : me.lastThrowCard, throwPlace : me.lastThrowPlace} );
}

// 玩家将牌
Room.prototype.PlayerJiangCards = function (player) {
    var me = this;
    // 玩家将牌
    player.AddJiangCard(me.lastThrowCard);
    // 触发检测
    me.TriggerSelfCheck(player);
    // 通知
    me.BroadcastPlayers2(player, "jiangCards", me.lastThrowCard, me.lastThrowPlace);
    // 改变出牌位置
    me.getCardPlace = player.data.place;

    me.replay.AddAction('jiangCards', player.place, { card : me.lastThrowCard, throwPlace : me.lastThrowPlace} );
}

// 玩家吃牌
Room.prototype.PlayerChiCard = function(player, kindIndex) {
    var me = this;
    var arr = Mahjong.GetChiCards(player.data.cards, me.lastThrowCard);
    if (arr.length <= kindIndex) {
        return false;
    }
    // 玩家吃牌
    player.AddChiCard(me.lastThrowCard, arr[kindIndex]);
    // 触发检测
    me.TriggerSelfCheck(player);
    // 通知
    me.BroadcastPlayers2(player, "chiCards", me.lastThrowCard, me.lastThrowPlace);
    // 改变出牌位置
    me.getCardPlace = player.data.place;

    me.replay.AddAction('chiCards', player.place, { card : me.lastThrowCard, throwPlace : me.lastThrowPlace});

    return true;
}

// 玩家坎牌
Room.prototype.PlayerKanCards = function (player) {
    var me = this;
    // 玩家坎牌
    var card = player.KanCards();
    // 触发检测
    me.TriggerSelfCheck(player);
    // 通知
    me.BroadcastPlayers2(player, "kanCards");

    me.replay.AddAction('kanCards', player.place, card);
}

// 玩家牛牌
Room.prototype.PlayerNiuCards = function (player) {
    var me = this;
    // 玩家牛牌
    var countArray = [];
    var c = 0;
    Mahjong.HasNiuCardsByHand(player.data.cards, countArray);
    var i;
    for (i = 0; i < countArray.length; ++i) {
        c += countArray[i];
    }
    
    var addNum = c - 3;
    var addCards = [];
    for (i = 0; i < addNum; ++i) {
        addCards.push(me.cards[me.cardsIndex++]);
    }
    player.NiuCards(countArray, addCards);
    
    // 触发检测
    me.TriggerSelfCheck(player);
    // 通知
    me.BroadcastPlayers2(player, "niuCards", addCards);

    me.replay.AddAction('niuCards', player.place, addCards);
}

// 移除玩家上次打出的牌
Room.prototype.RemoveLastOneInPlayerOutputCards = function() {
    var me = this;
    var card = me.lastThrowCard;
    var place = me.lastThrowPlace;
    var player = me.players[place];
    player.data.outputCards.pop();
}

// 计算玩家分数
Room.prototype.CalcPlayersScore = function(winnerPlace, selfHu) {
    var me = this;
    var player, other, tempScore;
    var hasZhuangXian = me.RuleHasZhuangXian();
    var winner = me.players[winnerPlace];
    
    if (winner.data.piao) {
        for (var p = 0; p < me.players.length; ++p) {
            // 不算其他玩家分底
            if (p !== winnerPlace) {
                player = me.players[p];
                player.data.score = 0;
            }
        }
    }
    
    for (var i = 0; i < me.players.length; ++i) {
        player = me.players[i];
        for (var j = 0; j < me.players.length; ++j) {
            if (i !== j) {
                other = me.players[j];

                tempScore = player.data.score - other.data.score;
                if (hasZhuangXian && (i === me.bankerPlace || j === me.bankerPlace)) {
                    // 庄闲翻倍
                    tempScore *= 2;
                }
                
                if (winner.data.piao && (i === winnerPlace || j === winnerPlace)) {
                    // 飘牌翻倍 + 荤低
                    tempScore *= 2;
                    if (tempScore >= 0) {
                        tempScore += me.hunCount;
                    }else {
                        tempScore -= me.hunCount;
                    }
                }

                player.data.singleScore += tempScore;
            }
        }
    }
    
    if (winner.data.piao) {
        if (me.CalcBaoCard(winnerPlace, selfHu) === true) {
            // 包牌将让出牌者代付其他玩家输掉的分数
            var thrower = me.players[me.lastThrowPlace]; 
            for (var p = 0; p < me.players.length; ++p) {
                if (p !== winnerPlace && p !== me.lastThrowPlace) {
                    player = me.players[p];
                    thrower.data.singleScore += player.data.singleScore;
                    player.data.singleScore = 0;
                }
            }
        }
    }
    
    for (var pi = 0; pi < me.players.length; ++pi) {
        player = me.players[pi];
        player.data.totalScore += player.data.singleScore;
    }
}

// 检测包牌
Room.prototype.CalcBaoCard = function(winnerPlace, selfHu) {
    var me = this;
    var bao = false;
    var winner = me.players[winnerPlace];
    // 包牌规则
    if (winner.data.piao && selfHu === false) {
        var thrower = me.players[me.lastThrowPlace]; 
        var card;
        var outputCardMap = new Array(50);
        Util.ArrayZero(outputCardMap);
        
        if (winner.data.cards.length === 1) {
            // 单张飘牌包五张
            var card = winner.data.piaoCard;
            var base = Math.floor(card / 10);
            var mod = card % 10;
            for (var m = mod - 2; m <= mod + 2; ++m) {
                if (m >= 1 && m <= 9) {
                    if (me.lastThrowCard === (base + m)) {
                        bao = true;
                        break;
                    }
                }
            }
        }
        
        if (bao === true) return true;
        
        for (var i = 0; i < me.players.length; ++i) {
            player = me.players[i];
            // 检测已经碰的牌,如果手上有已经碰过的牌而不打,就算包
            if (player.data.pengCards.length > 0) {
                for (var j = 0; j < player.data.pengCards.length; j+=3) {
                    card = player.data.pengCards[j];
                    if (thrower.HasCard(card) === true) {
                        bao = true;
                        break;
                    }
                }
            }
            
            if (me.RuleCanJiang() && winner.data.cards.length === 4) {
                // 如果可以将牌,检测已经将过的牌,如果手上有已经将过的牌而不打,就算包(只针对飘2对的)
                if (player.data.jiangCards.length > 0) {
                    for (var ji = 0; ji < player.data.jiangCards.length; ji+=2) {
                        card = player.data.jiangCards[ji];
                        if (thrower.HasCard(card) === true){
                            bao = true;
                            break;
                        }
                    }
                }
            }
            
            // 统计已打出的牌.
            if (player.data.outputCards.length > 0) {
                for (var j = 0; j < player.data.outputCards.length; ++j) {
                    ++outputCardMap[player.data.outputCards[j]];
                }
            }
        }
        
        if (bao === true) return true;

        for (var j = 0; j < outputCardMap.length; ++j) {
             // 检测已经打出去的牌,如果手上有已经打出三张的牌而不打,就算包
            if (outputCardMap[j] === 3) {
                if (thrower.HasCard(j)) {
                    bao = true;
                    break;
                }
            }
            
            if (j === me.lastThrowCard) {
                // 如果玩家打了一张没有出现过的牌,就算包.
                if (outputCardMap[j] === 1) {
                    for (var jc = 0; jc < thrower.data.cards.length; ++jc) {
                        if (outputCardMap[thrower.data.cards[jc]] >= 1) {
                            bao = true;
                            break;
                        }
                    }
                }
            }
            
            if (winner.data.cards.length === 4) {
                // 检测已经打出去的牌,如果手上有已经打出两张的牌而不打,就算包(只针对飘2对的)
                if (outputCardMap[j] === 2) {
                    if (thrower.HasCard(j)) {
                        bao = true;
                        break;
                    }
                }
            }
        }
    }
    
    return bao;
}

// 单局结束
Room.prototype.GameEnd = function(status) {
    var me = this;

    // 录像结束
    me.replay.End();

    me.state = 3; // 结算状态
    me.playing = false;
    ++me.playCount;
    
    // 发送结算
    Room.prototype.SendAccountsCards(me, status);
    
    // 写入记录到数据库
    GameDB.UpdateRoomData(me.createUserId, Room.prototype.DBSaveRoomInfo(me));
    
    if (me.IsFullQuan() === false) {
        // 新一局准备.
        me.CancelPlayerReady();
        me.SendPlayerReady();
    }else {
        // 总结算
        GameLog(me.roomName +　"总结算");
        me.Shutdown();
    }
}

// 发送房间信息
Room.prototype.SendRoomInfo = function(room) {
    
    var data = {    "id"                : room.id,
                    "ownerId"           : room.createUserId,
                    "time"              : room.time,
                    "ruleId"            : room.ruleId,
                    "quanId"            : room.quanId,
                    "hunCount"          : room.hunCount,
                    "playCount"         : room.playCount,
                    "played"            : room.playing ? 1 : 0 };
                    
    if (room.playing) {
        var remainNumber = (room.cards.length - 1) - room.cardsIndex;
        data.remainNum = remainNumber;
    }
    
    return JSON.stringify(data);
}

// 发送单局结算 status 1.流局 2.胡牌 3.发起结算 
Room.prototype.SendAccountsCards = function(room, status) {
    var me = room;
    var datas = [];
    var player = null;
    
    for (var i = 0; i < me.playData.length; ++i){
        datas.push(Player.prototype.SendAllCards(me.playData[i]));
    }
    
    var totalScore = [me.playData[0].totalScore,
                      me.playData[1].totalScore,
                      me.playData[2].totalScore,
                      me.playData[3].totalScore]
    
    var gameEnd = status === 3 ? true : me.IsFullQuan();
    var msg;
    for (var j = 0; j < me.players.length; ++j){
        player = me.players[j];
        if (player) {
            msg = { status : status , playData : datas, totalScore : totalScore };
            if (gameEnd === true) {
                msg.gameEnd = gameEnd;
            }
            player.socket.emit("accounts", msg);
        }
    }
}

// 发送总结算
Room.prototype.SendDestoryRoom = function(room) {
    var me = room;
    var data = [-1,-1,-1,-1];
    for (var i = 0; i < me.playData.length; ++i) {
        if (typeof me.playData[i].agreeDestoryRoom !== 'undefined') {
            data[i] = me.playData[i].agreeDestoryRoom;
        }
    }
    me.BroadcastPlayers(null, "destoryRoomBack", data);
}

// 房间信息存数据库
Room.prototype.DBSaveRoomInfo = function(room) {
    
    var data = {    "id"                : room.id,
                    "ownerId"           : room.createUserId,
                    "time"              : room.time,
                    "ruleId"            : room.ruleId,
                    "quanId"            : room.quanId,
                    "hunCount"          : room.hunCount,
                    "playCount"         : room.playCount,
                    "costMoney"         : room.costMoney,
                    "bankerCount"       : room.bankerCount};
    
    return data;
}