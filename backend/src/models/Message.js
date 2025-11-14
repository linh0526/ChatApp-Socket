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
        return this.messageType !== 'voice' && this.messageType !== 'image';
      },
      trim: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
    },
    messageType: {
      type: String,
      enum: ['text', 'voice', 'image'],
      default: 'text',
    },
    voiceRecording: {
      data: { type: Buffer },
      mimeType: { type: String },
      size: { type: Number },
      originalName: { type: String },
      durationMs: { type: Number },
    },
    image: {
      data: { type: Buffer },
      mimeType: { type: String },
      size: { type: Number },
      originalName: { type: String },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);

