import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Peer from 'simple-peer';
import { auth, signOut } from '../firebase';

const ENDPOINT = 'http://localhost:5000';

function ChatPage() {
  const [messages, setMessages] = useState({});
  const [newMessage, setNewMessage] = useState('');
  const [user, setUser] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [allUsersList, setAllUsersList] = useState([]);
  const [onlineUsersList, setOnlineUsersList] = useState([]);
  const [selectedUserEmail, setSelectedUserEmail] = useState(null);

  // Call States
  const [stream, setStream] = useState(null);
  const [receivingCall, setReceivingCall] = useState(false);
  const [callerSignal, setCallerSignal] = useState(null);
  const [callerEmail, setCallerEmail] = useState('');
  const [callAccepted, setCallAccepted] = useState(false);
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const myVideoRef = useRef();
  const userVideoRef = useRef();
  const connectionRef = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    const userInfo = JSON.parse(localStorage.getItem('userInfo'));
    if (!userInfo) {
      navigate('/');
    } else {
      setUser(userInfo);
    }
  }, [navigate]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const { data } = await axios.get(`${ENDPOINT}/api/users`);
        setAllUsersList(data);
      } catch (err) {
        console.log('Error fetching all users', err);
      }
    };
    fetchUsers();
  }, []);

  const endCallLocally = useCallback(() => {
    setCallAccepted(false);
    setReceivingCall(false);
    if (connectionRef.current) connectionRef.current.destroy();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    setStream(null);
  }, [stream]);

  // Stable Socket Connection
  useEffect(() => {
    if (!user) return;

    if (!socketRef.current) {
      socketRef.current = io(ENDPOINT);
    }

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Connected to socket.io');
      socket.emit('setup', user);
    });

    socket.on('online users', (users) => {
      setOnlineUsersList(users);
      const userObjects = users.map(email => ({ email }));
      setAllUsersList(prev => {
        const existingEmails = new Set(prev.map(p => p.email));
        const newUsers = userObjects.filter(u => !existingEmails.has(u.email));
        return [...prev, ...newUsers];
      });
    });

    socket.on('message received', (data) => {
      setMessages((prev) => ({
        ...prev,
        [data.room]: [
          ...(prev[data.room] || []),
          { 
            _id: data._id || Date.now().toString(),
            sender: data.sender, 
            content: data.content, 
            time: data.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isSentByMe: false 
          },
        ],
      }));
    });

    socket.on('message deleted', (deletedId) => {
      setMessages((prev) => {
        const updatedState = { ...prev };
        for (const room in updatedState) {
          updatedState[room] = updatedState[room].filter((msg) => msg._id !== deletedId);
        }
        return updatedState;
      });
    });

    socket.on('typing', () => setIsOtherTyping(true));
    socket.on('stop typing', () => setIsOtherTyping(false));

    socket.on('callUser', (data) => {
      setReceivingCall(true);
      setCallerEmail(data.from);
      setCallerSignal(data.signal);
      setIsAudioOnly(data.isAudioOnly);
    });

    socket.on('callEnded', () => {
      endCallLocally();
    });

    return () => {
      socket.off('connect');
      socket.off('online users');
      socket.off('message received');
      socket.off('message deleted');
      socket.off('typing');
      socket.off('stop typing');
      socket.off('callUser');
      socket.off('callEnded');
    };
  }, [user, endCallLocally]);

  const getRoomId = (email1, email2) => {
    if (!email1 || !email2) return null;
    return [email1.toLowerCase(), email2.toLowerCase()].sort().join('_room_');
  };

  const activeRoomId = selectedUserEmail ? getRoomId(user?.email, selectedUserEmail) : null;

  const handleSelectUser = (targetEmail) => {
    setSelectedUserEmail(targetEmail);
    setIsOtherTyping(false);
    const roomId = getRoomId(user?.email, targetEmail);
    if (roomId && socketRef.current) {
      socketRef.current.emit('join chat', roomId);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeRoomId, isOtherTyping]);

  const handleInputChange = (e) => {
    setNewMessage(e.target.value);

    if (!isTyping && activeRoomId && socketRef.current) {
      setIsTyping(true);
      socketRef.current.emit('typing', activeRoomId);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      if (activeRoomId && socketRef.current) socketRef.current.emit('stop typing', activeRoomId);
      setIsTyping(false);
    }, 2500);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeRoomId || !socketRef.current) return;

    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tempId = Date.now().toString();

    socketRef.current.emit('stop typing', activeRoomId);
    setIsTyping(false);

    const messagePayload = {
      _id: tempId,
      sender: user?.email,
      content: newMessage,
      room: activeRoomId,
      time: currentTime
    };

    socketRef.current.emit('new message', messagePayload);

    setMessages((prev) => ({
      ...prev,
      [activeRoomId]: [
        ...(prev[activeRoomId] || []),
        { _id: tempId, sender: user?.email, content: newMessage, time: currentTime, isSentByMe: true },
      ],
    }));

    setNewMessage('');
  };

  const handleDeleteMessage = async (msgId) => {
    if (!msgId || !activeRoomId) return;

    try {
      if (msgId.length === 24) {
        await axios.delete(`${ENDPOINT}/api/messages/${msgId}`);
      }
    } catch (err) {
      console.log('Error deleting message:', err);
    }

    if (socketRef.current) {
      socketRef.current.emit('delete message', { messageId: msgId, room: activeRoomId });
    }

    setMessages((prev) => ({
      ...prev,
      [activeRoomId]: prev[activeRoomId].filter((msg) => msg._id !== msgId),
    }));
  };

  const startCall = (audioOnly = false) => {
    setIsAudioOnly(audioOnly);
    navigator.mediaDevices
      .getUserMedia({ video: !audioOnly, audio: true })
      .then((currentStream) => {
        setStream(currentStream);
        if (myVideoRef.current) myVideoRef.current.srcObject = currentStream;

        const peer = new Peer({
          initiator: true,
          trickle: false,
          stream: currentStream,
        });

        peer.on('signal', (data) => {
          if (socketRef.current) {
            socketRef.current.emit('callUser', {
              userToCall: selectedUserEmail,
              signalData: data,
              from: user.email,
              isAudioOnly: audioOnly,
            });
          }
        });

        peer.on('stream', (remoteStream) => {
          if (userVideoRef.current) {
            userVideoRef.current.srcObject = remoteStream;
            userVideoRef.current.play().catch(e => console.log("Audio play error:", e));
          }
        });

        if (socketRef.current) {
          socketRef.current.on('callAccepted', (signal) => {
            setCallAccepted(true);
            peer.signal(signal);
          });
        }

        connectionRef.current = peer;
      })
      .catch((err) => console.log('Media Permission Denied:', err));
  };

  const answerCall = () => {
    setCallAccepted(true);
    navigator.mediaDevices
      .getUserMedia({ video: !isAudioOnly, audio: true })
      .then((currentStream) => {
        setStream(currentStream);
        if (myVideoRef.current) myVideoRef.current.srcObject = currentStream;

        const peer = new Peer({
          initiator: false,
          trickle: false,
          stream: currentStream,
        });

        peer.on('signal', (data) => {
          if (socketRef.current) {
            socketRef.current.emit('answerCall', { signal: data, to: callerEmail });
          }
        });

        peer.on('stream', (remoteStream) => {
          if (userVideoRef.current) {
            userVideoRef.current.srcObject = remoteStream;
            userVideoRef.current.play().catch(e => console.log("Audio play error:", e));
          }
        });

        peer.signal(callerSignal);
        connectionRef.current = peer;
      })
      .catch((err) => console.log('Media Permission Denied:', err));
  };

  const leaveCall = () => {
    if (socketRef.current) {
      socketRef.current.emit('endCall', { to: selectedUserEmail || callerEmail });
    }
    endCallLocally();
  };

  const handleLogout = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    signOut(auth);
    localStorage.removeItem('userInfo');
    navigate('/');
  };

  const otherUsers = allUsersList.filter(
    (u) => u.email && u.email.toLowerCase() !== (user?.email || '').toLowerCase()
  );

  const currentChatMessages = activeRoomId ? messages[activeRoomId] || [] : [];

  if (!user) return null;

  return (
    <div style={styles.appWrapper}>
      <div style={styles.mainContainer}>
        {/* Sidebar */}
        <div style={styles.sidebar}>
          <div style={styles.profileHeader}>
            <div style={styles.avatar}>
              {user.email.substring(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={styles.userEmailText}>{user.name || user.email}</div>
              <span style={{ fontSize: '12px', color: '#22c55e' }}>● Online</span>
            </div>
            <button onClick={handleLogout} style={styles.logoutBtn} title="Logout">
              ✕
            </button>
          </div>

          <div style={styles.usersListHeader}>
            <span>ONLINE USERS</span>
            <span style={styles.badge}>{otherUsers.filter(u => onlineUsersList.includes(u.email)).length}</span>
          </div>

          <div style={styles.usersScrollArea}>
            {otherUsers.length === 0 ? (
              <p style={styles.emptyText}>No other active users</p>
            ) : (
              otherUsers.map((u, idx) => {
                const isOnline = onlineUsersList.includes(u.email);
                const isSelected = selectedUserEmail === u.email;
                return (
                  <div
                    key={idx}
                    onClick={() => handleSelectUser(u.email)}
                    style={{
                      ...styles.userCard,
                      backgroundColor: isSelected ? '#1e293b' : 'transparent',
                      borderLeft: isSelected ? '4px solid #6366f1' : '4px solid transparent',
                    }}
                  >
                    <div style={styles.userAvatar}>
                      {u.email.substring(0, 2).toUpperCase()}
                      <span
                        style={{
                          ...styles.statusDot,
                          backgroundColor: isOnline ? '#22c55e' : '#64748b',
                        }}
                      />
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={styles.cardEmail}>{u.email}</div>
                      <div style={styles.cardStatus}>
                        {isOnline ? 'Active now' : 'Offline'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div style={styles.chatArea}>
          {selectedUserEmail ? (
            <>
              <div style={styles.chatHeader}>
                <div style={styles.userAvatar}>
                  {selectedUserEmail.substring(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: '15px', color: '#f8fafc' }}>
                    {selectedUserEmail}
                  </h4>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                    {onlineUsersList.includes(selectedUserEmail) ? 'Online' : 'Offline'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => startCall(true)} style={styles.callBtn} title="Audio Call">
                    📞
                  </button>
                  <button onClick={() => startCall(false)} style={styles.callBtn} title="Video Call">
                    📹
                  </button>
                </div>
              </div>

              {(stream || callAccepted) && (
                <div style={styles.callOverlay}>
                  <div style={styles.videoContainer}>
                    {!isAudioOnly && (
                      <video playsInline autoPlay ref={userVideoRef} style={styles.remoteVideo} />
                    )}
                    <video playsInline muted autoPlay ref={myVideoRef} style={styles.localVideo} />
                    <button onClick={leaveCall} style={styles.endCallBtn}>
                      End Call
                    </button>
                  </div>
                </div>
              )}

              {receivingCall && !callAccepted && (
                <div style={styles.incomingCallBox}>
                  <p style={{ margin: 0, color: '#fff', fontSize: '14px' }}>
                    Incoming {isAudioOnly ? 'Audio' : 'Video'} Call from <strong>{callerEmail}</strong>
                  </p>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button onClick={answerCall} style={styles.acceptBtn}>Accept</button>
                    <button onClick={leaveCall} style={styles.rejectBtn}>Reject</button>
                  </div>
                </div>
              )}

              <div style={styles.messagesBox}>
                {currentChatMessages.map((msg) => (
                  <div
                    key={msg._id}
                    style={{
                      ...styles.messageRow,
                      justifyContent: msg.isSentByMe ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        ...styles.bubble,
                        backgroundColor: msg.isSentByMe ? '#6366f1' : '#1e293b',
                        color: msg.isSentByMe ? '#ffffff' : '#f1f5f9',
                        borderBottomRightRadius: msg.isSentByMe ? '4px' : '16px',
                        borderBottomLeftRadius: msg.isSentByMe ? '16px' : '4px',
                      }}
                    >
                      <div>{msg.content}</div>
                      <div style={styles.bubbleFooter}>
                        <span style={{ fontSize: '10px', color: msg.isSentByMe ? '#c7d2fe' : '#94a3b8' }}>
                          {msg.time}
                        </span>
                        {msg.isSentByMe && (
                          <button
                            onClick={() => handleDeleteMessage(msg._id)}
                            style={styles.deleteBtn}
                            title="Delete Message"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {isOtherTyping && (
                  <div style={styles.typingBox}>Typing...</div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} style={styles.inputContainer}>
                <input
                  type="text"
                  placeholder={`Write a message...`}
                  value={newMessage}
                  onChange={handleInputChange}
                  style={styles.chatInput}
                />
                <button type="submit" style={styles.sendBtn}>
                  Send ➔
                </button>
              </form>
            </>
          ) : (
            <div style={styles.emptyChatPlaceholder}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>💬</div>
              <h3 style={{ margin: '0 0 8px 0', color: '#f8fafc' }}>Your Messages</h3>
              <p style={{ color: '#64748b', fontSize: '14px' }}>
                Select a user to start chatting or calling.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  appWrapper: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    backgroundColor: '#0b0f19',
    fontFamily: "'Inter', sans-serif",
  },
  mainContainer: {
    display: 'flex',
    width: '90%',
    maxWidth: '1100px',
    height: '85vh',
    backgroundColor: '#0f172a',
    borderRadius: '16px',
    border: '1px solid #1e293b',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
  },
  sidebar: {
    width: '320px',
    backgroundColor: '#151c2c',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
  },
  profileHeader: {
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    borderBottom: '1px solid #1e293b',
    backgroundColor: '#0f172a',
  },
  avatar: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: '#6366f1',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: '14px',
  },
  userEmailText: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#f8fafc',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  logoutBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '16px',
  },
  usersListHeader: {
    padding: '16px 16px 8px 16px',
    fontSize: '11px',
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: '0.05em',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    backgroundColor: '#1e293b',
    color: '#cbd5e1',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '10px',
  },
  usersScrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
  },
  userCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    marginBottom: '4px',
  },
  userAvatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#334155',
    color: '#cbd5e1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '600',
    fontSize: '12px',
    position: 'relative',
  },
  statusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    position: 'absolute',
    bottom: '0',
    right: '0',
    border: '2px solid #1e293b',
  },
  cardEmail: {
    fontSize: '13px',
    color: '#f1f5f9',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  cardStatus: {
    fontSize: '11px',
    color: '#64748b',
  },
  emptyText: {
    color: '#64748b',
    fontSize: '13px',
    textAlign: 'center',
    marginTop: '20px',
  },
  chatArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#0f172a',
    position: 'relative',
  },
  chatHeader: {
    padding: '16px 24px',
    borderBottom: '1px solid #1e293b',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: '#0f172a',
  },
  callBtn: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#fff',
    borderRadius: '8px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  messagesBox: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  messageRow: {
    display: 'flex',
    width: '100%',
  },
  bubble: {
    maxWidth: '65%',
    padding: '10px 16px',
    borderRadius: '16px',
    fontSize: '14px',
    lineHeight: '1.4',
    wordBreak: 'break-word',
  },
  bubbleFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '4px',
    gap: '8px',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    opacity: 0.7,
  },
  typingBox: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e293b',
    padding: '8px 16px',
    borderRadius: '16px',
    fontSize: '12px',
    color: '#94a3b8',
  },
  inputContainer: {
    padding: '16px 24px',
    borderTop: '1px solid #1e293b',
    display: 'flex',
    gap: '12px',
    backgroundColor: '#0f172a',
  },
  chatInput: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
  },
  sendBtn: {
    padding: '12px 20px',
    backgroundColor: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  emptyChatPlaceholder: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  callOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    zIndex: 10,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoContainer: {
    position: 'relative',
    width: '80%',
    height: '80%',
    backgroundColor: '#000',
    borderRadius: '12px',
    overflow: 'hidden',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  localVideo: {
    position: 'absolute',
    bottom: '16px',
    right: '16px',
    width: '150px',
    height: '100px',
    borderRadius: '8px',
    objectFit: 'cover',
    border: '2px solid #6366f1',
  },
  endCallBtn: {
    position: 'absolute',
    bottom: '20px',
    backgroundColor: '#ef4444',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 24px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  incomingCallBox: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    backgroundColor: '#1e293b',
    border: '1px solid #6366f1',
    padding: '16px',
    borderRadius: '12px',
    zIndex: 20,
  },
  acceptBtn: {
    backgroundColor: '#22c55e',
    color: '#fff',
    border: 'none',
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  rejectBtn: {
    backgroundColor: '#ef4444',
    color: '#fff',
    border: 'none',
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

export default ChatPage;