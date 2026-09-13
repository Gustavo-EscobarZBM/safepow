import 'package:flutter_test/flutter_test.dart';
import 'package:inventory_loss_app/core/network/api_client.dart';
import 'package:inventory_loss_app/data/repositories/loss_verification_repository.dart';

class _FakeApiClient extends ApiClient {
  dynamic nextGetResponse;
  String? lastPatchedPath;

  @override
  Future<dynamic> get(String path) async {
    if (path == '/losses/pending-verification') return nextGetResponse;
    throw UnimplementedError('not stubbed: $path');
  }

  @override
  Future<dynamic> patch(String path, Map<String, dynamic> body) async {
    lastPatchedPath = path;
    return {'ok': true};
  }
}

void main() {
  test('fetchPending() busca a lista em GET /losses/pending-verification e converte cada item', () async {
    final apiClient = _FakeApiClient()
      ..nextGetResponse = [
        {
          'id': 'loss-1',
          'quantity': '2.000',
          'description': 'Caiu da prateleira',
          'occurredAt': '2026-09-13T12:00:00.000Z',
          'product': {'name': 'Arroz 5kg'},
          'reportedBy': {'name': 'João Funcionário'},
        },
      ];
    final repository = LossVerificationRepository(apiClient: apiClient);

    final result = await repository.fetchPending();

    expect(result, hasLength(1));
    expect(result.first.productName, 'Arroz 5kg');
    expect(result.first.reportedByName, 'João Funcionário');
    expect(result.first.quantity, 2.0);
  });

  test('confirm() chama PATCH /losses/:id/verify', () async {
    final apiClient = _FakeApiClient();
    final repository = LossVerificationRepository(apiClient: apiClient);

    await repository.confirm('loss-1');

    expect(apiClient.lastPatchedPath, '/losses/loss-1/verify');
  });
}
