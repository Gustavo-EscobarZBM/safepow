class LossLocation {
  final String id;
  final String name;

  LossLocation({required this.id, required this.name});

  factory LossLocation.fromApiJson(Map<String, dynamic> json) {
    return LossLocation(id: json['id'] as String, name: json['name'] as String);
  }

  factory LossLocation.fromLocalMap(Map<String, dynamic> map) {
    return LossLocation(id: map['id'] as String, name: map['name'] as String);
  }

  Map<String, dynamic> toLocalMap() => {'id': id, 'name': name};
}
