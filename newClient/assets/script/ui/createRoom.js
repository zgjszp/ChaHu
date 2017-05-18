cc.Class({
    extends: cc.Component,

    properties: {
        closeBtn : cc.Button,
        createRoomBtn : cc.Button,
        
        ruleRadioButton: {
            default: [],
            type: cc.Toggle
        },
        
        _ruleCurrentToggle : cc.Toggle,
        _ruleToggleId : cc.Integer,
        
        juRadioButton: {
            default: [],
            type: cc.Toggle
        },
        
        _juCurrentToggle : cc.Toggle,
        _juToggleId : cc.Integer,
        
        sliderBar : cc.Slider,
        progressBar : cc.ProgressBar,
        hunCount : cc.Label,
    },

    // use this for initialization
    onLoad: function () {

        this.closeBtn.node.on('click', this.OnHide, this);
        this.createRoomBtn.node.on('click', this.OnCreateRoom, this);
        
        this.sliderBar.progress = 0;
        this.hunCount.string = '0';
        this.progressBar.progress = this.sliderBar.progress;
        this.createRoomBtn.interactable = true;
        
        this.ruleRadioButton[0].check();
        this._ruleToggleId = 1;
        this.juRadioButton[0].check();
        this._juToggleId = 1;
    },
    
    OnShow : function() {
       this.node.active = true;
       this.createRoomBtn.interactable = true;
    },
    
    OnHide : function() {
        this.node.active = false;
    },
    
    OnCreateRoom : function() {
        this.createRoomBtn.interactable = false;
        
        var ruleId = this._ruleToggleId;
        var quanId = this._juToggleId;
        var hunCount = (Math.ceil(this.progressBar.progress * 10) / 10) * 100;
        
        GameSocket().Send("createRoom", {ruleId:ruleId, quanId:quanId, hunCount:hunCount});
    },
    
    OnSlider : function (event) {
        var progress = event.progress;
        
        var newProgress = Math.ceil(progress * 10) / 10;
        this.sliderBar.progress = newProgress;
        this.progressBar.progress = newProgress;
        this.hunCount.string = "" + newProgress * 100;
    },
    
    OnRuleRadioChange : function(toggle, data) {
        if (this._ruleCurrentToggle !== toggle) {
            this._ruleCurrentToggle = toggle;
            this._ruleToggleId = parseInt(data);
        }
    },
    
    OnJuRadioChange : function(toggle, data) {
        if (this._juCurrentToggle !== toggle) {
            this._juCurrentToggle = toggle;
            this._juToggleId = parseInt(data);
        }
    },

    // called every frame, uncomment this function to activate update callback
    // update: function (dt) {

    // },
});