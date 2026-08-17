const Message = require('../models/Message');

// @desc Send New Message
const sendMessage = async (req, res) => {
  const { content, chatId } = req.body;

  if (!content) {
    return res.status(400).json({ message: 'Message content is required' });
  }

  try {
    let newMessage = {
      sender: req.user._id,
      content: content,
      chat: chatId || 'default_room_1',
    };

    let message = await Message.create(newMessage);
    message = await message.populate('sender', 'name avatar');

    res.json(message);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc Fetch All Messages
const allMessages = async (req, res) => {
  try {
    const messages = await Message.find({ chat: req.params.chatId }).populate(
      'sender',
      'name avatar email'
    );
    res.json(messages);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = { sendMessage, allMessages };