class LossReason {
  final String id;
  final String name;

  LossReason({required this.id, required this.name});

  factory LossReason.fromApiJson(Map<String, dynamic> json) {
    return LossReason(id: json['id'] as String, name: json['name'] as String);
  }

  factory LossReason.fromLocalMap(Map<String, dynamic> map) {
    return LossReason(id: map['id'] as String, name: map['name'] as String);
  }

  Map<String, dynamic> toLocalMap() => {'id': id, 'name': name};
}
