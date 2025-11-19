const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: String,
      required: true,
      trim: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    content: {
      type: String,
      required: function requiredContent() {
        return !['voice', 'image', 'file'].includes(this.messageType);
      },
      trim: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
    },
    messageType: {
      type: String,
      enum: ['text', 'voice', 'image', 'file'],
      default: 'text',
    },
    voiceRecording: {
      data: { type: Buffer },
      mimeType: { type: String },
      size: { type: Number },
      originalName: { type: String },
      durationMs: { type: Number },
      relativePath: { type: String },
      url: { type: String },
    },
    image: {
      data: { type: Buffer },
      mimeType: { type: String },
      size: { type: Number },
      originalName: { type: String },
      relativePath: { type: String },
      url: { type: String },
    },
    file: {
      data: { type: Buffer },
      mimeType: { type: String },
      size: { type: Number },
      originalName: { type: String },
      relativePath: { type: String },
      url: { type: String },
    },
    seenBy: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
      default: [],
    },
    isRecalled: {
      type: Boolean,
      default: false,
    },
    recalledAt: {
      type: Date,
    },
    recalledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);

