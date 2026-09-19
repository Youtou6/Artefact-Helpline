const { mongoose } = require('../config/db');
const { Schema } = mongoose;

const CounterSchema = new Schema({
  _id: { type: String, required: true }, // ex: "support", "order-a-build"
  seq: { type: Number, default: 0 },
});

CounterSchema.statics.next = async function (key) {
  const doc = await this.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

module.exports = mongoose.model('Counter', CounterSchema);
