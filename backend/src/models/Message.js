const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: function requiredContent() {
        return this.messageType !== 'voice';
      },
      trim: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
    },
    messageType: {
      type: String,
      enum: ['text', 'voice'],
      default: 'text',
    },
    voiceRecording: {
      data: { type: Buffer },
      mimeType: { type: String },
      size: { type: Number },
      originalName: { type: String },
      durationMs: { type: Number },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);

